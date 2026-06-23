import 'server-only';

import { and, desc, eq, sql , inArray} from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { walletReputation } from '@/drizzle/schema';
import { captureException, captureMessage } from '@/lib/observability/sentry';

type Chain = 'ethereum' | 'base' | 'polygon';
type ReputationOutcome = 'successful' | 'failed' | 'rug' | 'profitable' | 'consensus_correct' | 'copy_mint_success' | 'copy_mint_failed';

type ReputationUpdate = {
  walletAddress: string;
  chain?: Chain;
  outcome: ReputationOutcome;
  metadata?: Record<string, unknown>;
};

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

function isValidAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreDelta(outcome: ReputationOutcome) {
  switch (outcome) {
    case 'profitable':
      return 8;
    case 'successful':
    case 'copy_mint_success':
      return 5;
    case 'consensus_correct':
      return 4;
    case 'failed':
    case 'copy_mint_failed':
      return -5;
    case 'rug':
      return -18;
  }
}

function countDeltas(outcome: ReputationOutcome) {
  return {
    totalMints: 1,
    successfulProjects: outcome === 'successful' || outcome === 'profitable' || outcome === 'copy_mint_success' ? 1 : 0,
    failedProjects: outcome === 'failed' || outcome === 'copy_mint_failed' ? 1 : 0,
    rugProjects: outcome === 'rug' ? 1 : 0,
  };
}

export function reputationWeight(score: number) {
  if (score >= 90) return 2;
  if (score >= 75) return 1.5;
  if (score >= 50) return 1;
  if (score >= 25) return 0.5;
  return 0.2;
}

export async function getWalletReputation(walletAddress: string, chain: Chain = 'ethereum') {
  const normalized = normalizeAddress(walletAddress);
  if (!isValidAddress(normalized)) return null;

  const [row] = await getDb()
    .select()
    .from(walletReputation)
    .where(and(eq(walletReputation.walletAddress, normalized), eq(walletReputation.chain, chain)))
    .limit(1);

  return row ?? null;
}

export async function getWalletReputationWeight(walletAddress: string, chain: Chain = 'ethereum') {
  const reputation = await getWalletReputation(walletAddress, chain);
  return {
    reputationScore: reputation?.reputationScore ?? 50,
    weight: reputationWeight(reputation?.reputationScore ?? 50),
  };
}

export async function updateWalletReputation(input: ReputationUpdate) {
  try {
    const walletAddress = normalizeAddress(input.walletAddress);
    if (!isValidAddress(walletAddress)) throw new Error('Invalid wallet address');

    const chain = input.chain ?? 'ethereum';
    const [existing] = await getDb()
      .select()
      .from(walletReputation)
      .where(and(eq(walletReputation.walletAddress, walletAddress), eq(walletReputation.chain, chain)))
      .limit(1);

    const delta = scoreDelta(input.outcome);
    const counts = countDeltas(input.outcome);
    const previousScore = existing?.reputationScore ?? 50;
    const nextScore = clampScore(previousScore + delta);

    const [updated] = await getDb()
      .insert(walletReputation)
      .values({
        walletAddress,
        chain,
        reputationScore: nextScore,
        totalMints: counts.totalMints,
        successfulProjects: counts.successfulProjects,
        failedProjects: counts.failedProjects,
        rugProjects: counts.rugProjects,
        lastUpdated: new Date(),
      })
      .onConflictDoUpdate({
        target: [walletReputation.walletAddress, walletReputation.chain],
        set: {
          reputationScore: nextScore,
          totalMints: sql`${walletReputation.totalMints} + ${counts.totalMints}`,
          successfulProjects: sql`${walletReputation.successfulProjects} + ${counts.successfulProjects}`,
          failedProjects: sql`${walletReputation.failedProjects} + ${counts.failedProjects}`,
          rugProjects: sql`${walletReputation.rugProjects} + ${counts.rugProjects}`,
          lastUpdated: new Date(),
        },
      })
      .returning();

    if (Math.abs(nextScore - previousScore) >= 20) {
      await captureMessage('Wallet reputation changed significantly', {
        area: 'wallet-reputation',
        level: nextScore < previousScore ? 'warning' : 'info',
        context: { wallet: walletAddress, chain },
        extra: { previousScore, nextScore, outcome: input.outcome, metadata: input.metadata },
        fingerprint: ['wallet-reputation', 'significant-change'],
      });

      const { sendAdminTelegramAlert } = await import('@/lib/services/telegram.service');
      await sendAdminTelegramAlert([
        'Wallet reputation changed significantly',
        `Wallet: ${walletAddress}`,
        `Previous: ${previousScore}`,
        `Current: ${nextScore}`,
      ].join('\n'));
    }

    return updated;
  } catch (error) {
    await captureException(error, {
      area: 'wallet-reputation',
      context: { wallet: input.walletAddress, chain: input.chain },
      extra: { outcome: input.outcome, metadata: input.metadata },
      fingerprint: ['wallet-reputation', 'update'],
    });
    throw error;
  }
}

export async function getWalletReputationLeaderboard(limit = 10) {
  return getDb()
    .select()
    .from(walletReputation)
    .orderBy(desc(walletReputation.reputationScore), desc(walletReputation.successfulProjects))
    .limit(limit);
}

export async function getMostAccurateWallets(limit = 10) {
  return getDb()
    .select()
    .from(walletReputation)
    .where(sql`${walletReputation.totalMints} > 0`)
    .orderBy(sql`(${walletReputation.successfulProjects}::float / nullif(${walletReputation.totalMints}, 0)) desc`)
    .limit(limit);
}

export async function getMostSuccessfulCopyMintSources(limit = 10) {
  return getDb()
    .select()
    .from(walletReputation)
    .where(sql`${walletReputation.successfulProjects} > 0`)
    .orderBy(desc(walletReputation.successfulProjects), desc(walletReputation.reputationScore))
    .limit(limit);
}

/**
 * Batch version of getWalletReputationWeight.
 * Fetches reputation for all wallet addresses in a single DB query
 * instead of N separate queries — eliminates the N+1 pattern in
 * loadWeightedConsensus (whale-consensus.service.ts).
 *
 * Returns a Map keyed by normalised wallet address.
 */
export async function getBatchWalletReputationWeights(
  walletAddresses: string[],
  chain: string,
): Promise<Map<string, { reputationScore: number; weight: number }>> {
  const DEFAULT_WEIGHT = { reputationScore: 50, weight: 1 };

  if (walletAddresses.length === 0) {
    return new Map();
  }

  const normalised = walletAddresses.map((a) => a.trim().toLowerCase());

  try {
    const rows = await getDb()
      .select()
      .from(walletReputation)
      .where(inArray(walletReputation.walletAddress, normalised));

    const result = new Map<string, { reputationScore: number; weight: number }>();

    // Pre-fill defaults so every address has an entry
    for (const addr of normalised) {
      result.set(addr, { ...DEFAULT_WEIGHT });
    }

    // Overwrite with actual DB data where available
    for (const row of rows) {
      const score = row.reputationScore ?? DEFAULT_WEIGHT.reputationScore;
      result.set(row.walletAddress, {
        reputationScore: score,
        weight: score >= 80 ? 3 : score >= 60 ? 2 : 1,
      });
    }

    return result;
  } catch (error) {
    await captureException(error, {
      area: 'wallet-reputation',
      context: { chain, count: walletAddresses.length },
      fingerprint: ['wallet-reputation', 'batch-weight'],
    });
    // Fail open — return defaults for all addresses
    const fallback = new Map<string, { reputationScore: number; weight: number }>();
    for (const addr of normalised) {
      fallback.set(addr, { ...DEFAULT_WEIGHT });
    }
    return fallback;
  }
}

