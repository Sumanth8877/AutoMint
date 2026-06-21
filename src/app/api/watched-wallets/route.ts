import { NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { activities, copyMintRules, walletReputation } from '@/drizzle/schema';
import { parseJsonBody } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { getUserWatchedWallets, watchWallet } from '@/lib/services/wallet-tracker.service';

type ActivityMetadata = {
  walletAddress?: string;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Watched wallet request failed';
}

function metadataWallet(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return null;
  const walletAddress = (metadata as ActivityMetadata).walletAddress;
  return typeof walletAddress === 'string' ? walletAddress.toLowerCase() : null;
}

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const rows = await getUserWatchedWallets(authResult.userId);
    const addresses = Array.from(new Set(rows.map((wallet) => wallet.walletAddress)));
    const [rules, reputations, recentActivities] = await Promise.all([
      getDb().select().from(copyMintRules).where(eq(copyMintRules.userId, authResult.userId)),
      addresses.length > 0
        ? getDb().select().from(walletReputation).where(inArray(walletReputation.walletAddress, addresses))
        : Promise.resolve([]),
      getDb().select().from(activities)
        .where(eq(activities.userId, authResult.userId))
        .orderBy(desc(activities.createdAt))
        .limit(100),
    ]);

    const ruleByWallet = new Map(rules.map((rule) => [rule.walletAddress, rule]));
    const reputationByWallet = new Map(reputations.map((reputation) => [`${reputation.walletAddress}:${reputation.chain}`, reputation]));

    const wallets = rows.map((wallet) => {
      const rule = ruleByWallet.get(wallet.walletAddress);
      const lastActivity = recentActivities.find((activity) => metadataWallet(activity.metadata) === wallet.walletAddress.toLowerCase());
      const reputation = reputationByWallet.get(`${wallet.walletAddress}:${wallet.chain}`);

      return {
        ...wallet,
        reputationScore: reputation?.reputationScore ?? 50,
        copyMintStatus: rule ? (rule.enabled ? 'enabled' : 'disabled') : 'none',
        lastActivityAt: lastActivity?.createdAt ?? null,
      };
    });

    return NextResponse.json({ wallets });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{
      walletName?: string | null;
      walletAddress?: string;
      networkType?: string;
      chain?: string;
    }>(req);

    if (!body.walletAddress) {
      return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 });
    }

    const wallet = await watchWallet(authResult.userId, {
      walletName: body.walletName,
      walletAddress: body.walletAddress,
      networkType: body.networkType,
      chain: body.chain,
    });

    return NextResponse.json({ wallet }, { status: 201 });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes('Invalid') || message.includes('required') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
