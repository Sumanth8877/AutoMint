import { NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { activities, consensusEvents } from '@/drizzle/schema';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { getUserWatchedWallets } from '@/lib/services/wallet-tracker.service';
import { logger } from '@/lib/logger';

type WalletTrackerActivityMetadata = {
  type?: string;
  walletAddress?: string;
  contractAddress?: string;
  transactionHash?: string;
  riskScore?: number;
  copied?: boolean;
  copyStatus?: string;
};

function metadataValue(metadata: unknown): WalletTrackerActivityMetadata {
  return metadata && typeof metadata === 'object' ? metadata as WalletTrackerActivityMetadata : {};
}

function isWhaleTrackerActivity(metadata: WalletTrackerActivityMetadata, watchedAddresses: Set<string>) {
  return Boolean(metadata.walletAddress && watchedAddresses.has(metadata.walletAddress.toLowerCase()));
}

export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  try {
  const watched = await getUserWatchedWallets(authResult.userId);
  const watchedAddresses = new Set(watched.map((wallet) => wallet.walletAddress.toLowerCase()));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [userActivities, consensusRows] = await Promise.all([
    getDb()
      .select()
      .from(activities)
      .where(eq(activities.userId, authResult.userId))
      .orderBy(desc(activities.createdAt))
      .limit(100),
    watched.length > 0
      ? getDb()
        .select()
        .from(consensusEvents)
        .where(inArray(consensusEvents.walletAddress, watched.map((wallet) => wallet.walletAddress)))
        .orderBy(desc(consensusEvents.detectedAt))
        .limit(50)
      : Promise.resolve([]),
  ]);

  const items = userActivities
    .map((activity) => {
      const metadata = metadataValue(activity.metadata);
      if (!isWhaleTrackerActivity(metadata, watchedAddresses)) return null;

      return {
        id: activity.id,
        source: 'activity' as const,
        collectionName: metadata.contractAddress ?? 'Unknown collection',
        trackedWallet: metadata.walletAddress ?? '',
        time: activity.createdAt,
        riskScore: typeof metadata.riskScore === 'number' ? metadata.riskScore : null,
        copied: metadata.copied ?? activity.title.toLowerCase().includes('copy mint'),
        copyStatus: metadata.copyStatus ?? (activity.title.toLowerCase().includes('copy mint') ? 'Detected' : 'Not copied'),
        transactionHash: metadata.transactionHash ?? null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const consensusItems = consensusRows.map((event) => ({
    id: event.id,
    source: 'consensus' as const,
    collectionName: event.collection,
    trackedWallet: event.walletAddress,
    time: event.detectedAt,
    riskScore: null,
    copied: false,
    copyStatus: 'Consensus detected',
    transactionHash: null,
  }));

  const combined = [...items, ...consensusItems]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 100);

  const detectedMints24h = combined.filter((item) => new Date(item.time) >= since).length;
  const copiedMints24h = combined.filter((item) => item.copied && new Date(item.time) >= since).length;

  return NextResponse.json({
    activities: combined,
    metrics: {
      detectedMints24h,
      copiedMints24h,
    },
  });
  } catch (error) {
    logger.error('[whale-tracker/activity] DB query failed:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Failed to fetch whale tracker activity' }, { status: 500 });
  }
}
