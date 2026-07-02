import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { activities, copyMintRules } from '@/drizzle/schema';
import { parseJsonBody, handleRouteError } from '@/lib/api/errors';
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
    const [rules, recentActivities] = await Promise.all([
      getDb().select().from(copyMintRules).where(eq(copyMintRules.userId, authResult.userId)),
      getDb().select().from(activities)
        .where(eq(activities.userId, authResult.userId))
        .orderBy(desc(activities.createdAt))
        .limit(100),
    ]);

    const ruleByWallet = new Map(rules.map((rule) => [rule.walletAddress, rule]));

    const wallets = rows.map((wallet) => {
      const rule = ruleByWallet.get(wallet.walletAddress);
      const lastActivity = recentActivities.find((activity) => metadataWallet(activity.metadata) === wallet.walletAddress.toLowerCase());
      return {
        ...wallet,
        reputationScore: 50,
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
    return handleRouteError(error, 'Failed to process watched wallets');
  }
}
