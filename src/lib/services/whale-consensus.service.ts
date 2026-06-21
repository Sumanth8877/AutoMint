import 'server-only';

import { and, countDistinct, eq, lte } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { consensusEvents, mintTasks, trustedWallets, users, wallets } from '@/drizzle/schema';
import { getRedisClient, setCache } from '@/lib/redis';
import { logActivity } from '@/lib/monitoring';
import { getMintState } from '@/lib/services/mint-state.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { executeMintTask } from '@/lib/services/mint.service';
import { getWalletReputationWeight, updateWalletReputation } from '@/lib/services/wallet-reputation.service';
import { addBreadcrumb, captureException, captureMessage } from '@/lib/observability/sentry';

type Chain = 'ethereum' | 'base' | 'polygon';

type ConsensusEventInput = {
  walletAddress: string;
  collection: string;
  chain?: Chain;
  transactionHash?: string;
};

type TrustedWalletInput = {
  walletAddress: string;
  label?: string | null;
  active?: boolean;
};

type ConsensusConfidence = 'none' | 'medium' | 'high' | 'very_high';

const CONSENSUS_CACHE_TTL_SECONDS = 60 * 60;
const CONSENSUS_TRIGGER_TTL_SECONDS = 24 * 60 * 60;

function normalizeAddress(address: string) {
  return address.trim().toLowerCase();
}

function isValidAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function consensusCountKey(collection: string) {
  return `consensus:count:${normalizeAddress(collection)}`;
}

function consensusTriggerKey(userId: string, collection: string, threshold: number) {
  return `consensus:trigger:${userId}:${normalizeAddress(collection)}:${threshold}`;
}

function confidenceForWeightedScore(weightedScore: number): ConsensusConfidence {
  if (weightedScore >= 10) return 'very_high';
  if (weightedScore >= 5) return 'high';
  if (weightedScore >= 3) return 'medium';
  return 'none';
}

async function setTriggerOnce(userId: string, collection: string, threshold: number) {
  try {
    const result = await getRedisClient().set(
      consensusTriggerKey(userId, collection, threshold),
      Date.now(),
      { ex: CONSENSUS_TRIGGER_TTL_SECONDS, nx: true },
    );
    return result !== null && result !== undefined;
  } catch (error) {
    await captureException(error, {
      area: 'whale-consensus',
      context: { userId, collection },
      fingerprint: ['whale-consensus', 'redis-trigger'],
    });
    return true;
  }
}

async function loadConsensusCount(collection: string) {
  const [row] = await getDb()
    .select({ walletCount: countDistinct(consensusEvents.walletAddress) })
    .from(consensusEvents)
    .where(eq(consensusEvents.collection, normalizeAddress(collection)));

  const walletCount = Number(row?.walletCount ?? 0);
  await setCache(consensusCountKey(collection), walletCount, CONSENSUS_CACHE_TTL_SECONDS);
  return walletCount;
}

async function loadWeightedConsensus(collection: string, chain: Chain) {
  const events = await getDb()
    .select({ walletAddress: consensusEvents.walletAddress })
    .from(consensusEvents)
    .where(eq(consensusEvents.collection, normalizeAddress(collection)));

  let weightedScore = 0;
  const wallets = [];
  for (const event of events) {
    const reputation = await getWalletReputationWeight(event.walletAddress, chain);
    weightedScore += reputation.weight;
    wallets.push({
      walletAddress: event.walletAddress,
      reputationScore: reputation.reputationScore,
      weight: reputation.weight,
    });
  }

  return {
    walletCount: events.length,
    weightedScore: Math.round(weightedScore * 100) / 100,
    wallets,
  };
}

async function loadDefaultMintWallet(userId: string, chain: Chain) {
  const [sameChain] = await getDb()
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, chain)))
    .orderBy(wallets.createdAt)
    .limit(1);

  if (sameChain) return sameChain;

  const [fallback] = await getDb()
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .orderBy(wallets.createdAt)
    .limit(1);

  return fallback ?? null;
}

async function sendConsensusAlert(params: {
  userId: string;
  collection: string;
  walletCount: number;
  weightedScore: number;
  confidence: ConsensusConfidence;
}) {
  const { getTelegramAccountByUserId, sendTelegramMessage } = await import('@/lib/services/telegram.service');
  const account = await getTelegramAccountByUserId(params.userId);
  if (!account) return { sent: false, reason: 'telegram_not_linked' };

  await sendTelegramMessage(account.chatId, [
    'Whale Consensus Reached',
    `Collection: ${params.collection}`,
    `Wallet Count: ${params.walletCount}`,
    `Weighted Score: ${params.weightedScore}`,
    `Confidence: ${params.confidence.replace('_', ' ')}`,
  ].join('\n'), {
    replyMarkup: {
      inline_keyboard: [[
        { text: 'Copy Mint', callback_data: `consensus:copy:${params.collection}` },
        { text: 'Ignore', callback_data: `consensus:ignore:${params.collection}` },
      ]],
    },
  });

  return { sent: true };
}

export async function upsertTrustedWallet(data: TrustedWalletInput) {
  const walletAddress = normalizeAddress(data.walletAddress);
  if (!isValidAddress(walletAddress)) throw new Error('Invalid wallet address');

  const [wallet] = await getDb()
    .insert(trustedWallets)
    .values({
      walletAddress,
      label: data.label ?? null,
      active: data.active ?? true,
    })
    .onConflictDoUpdate({
      target: trustedWallets.walletAddress,
      set: {
        label: data.label ?? null,
        active: data.active ?? true,
      },
    })
    .returning();

  return wallet;
}

export async function recordTrustedWalletMintEvent(input: ConsensusEventInput) {
  try {
    const walletAddress = normalizeAddress(input.walletAddress);
    const collection = normalizeAddress(input.collection);
    const chain = input.chain ?? 'ethereum';

    if (!isValidAddress(walletAddress) || !isValidAddress(collection)) {
      return { triggered: false, reason: 'invalid_address' };
    }

    const [trusted] = await getDb()
      .select()
      .from(trustedWallets)
      .where(and(eq(trustedWallets.walletAddress, walletAddress), eq(trustedWallets.active, true)))
      .limit(1);

    if (!trusted) return { triggered: false, reason: 'wallet_not_trusted' };

    await getDb()
      .insert(consensusEvents)
      .values({ collection, walletAddress })
      .onConflictDoNothing({
        target: [consensusEvents.collection, consensusEvents.walletAddress],
      });

    const walletCount = await loadConsensusCount(collection);
    const weightedConsensus = await loadWeightedConsensus(collection, chain);
    const confidence = confidenceForWeightedScore(weightedConsensus.weightedScore);

    addBreadcrumb({
      category: 'whale-consensus',
      message: 'trusted wallet mint recorded',
      level: 'info',
      data: { collection, walletAddress, walletCount, weightedScore: weightedConsensus.weightedScore, confidence, chain },
    });

    if (confidence === 'none') {
      return { triggered: false, walletCount, confidence };
    }

    const eligibleUsers = await getDb()
      .select()
      .from(users)
      .where(and(eq(users.consensusEnabled, true), lte(users.consensusThreshold, Math.floor(weightedConsensus.weightedScore))));

    const notifications = [];
    for (const user of eligibleUsers) {
      const shouldTrigger = await setTriggerOnce(user.id, collection, user.consensusThreshold);
      if (!shouldTrigger) continue;

      await logActivity(user.id, 'mint_status_changed', 'Whale consensus reached', {
        collection,
        walletCount,
        weightedScore: weightedConsensus.weightedScore,
        confidence,
        sourceWallet: walletAddress,
        transactionHash: input.transactionHash,
        weightedWallets: weightedConsensus.wallets,
      });

      await sendConsensusAlert({
        userId: user.id,
        collection,
        walletCount,
        weightedScore: weightedConsensus.weightedScore,
        confidence,
      });
      await updateWalletReputation({
        walletAddress,
        chain,
        outcome: 'consensus_correct',
        metadata: { collection, walletCount, weightedScore: weightedConsensus.weightedScore },
      });
      const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
      await trackAnalyticsEvent({
        userId: user.id,
        eventType: 'whale_consensus',
        status: 'triggered',
        metadata: { collection, walletCount, weightedScore: weightedConsensus.weightedScore, confidence, sourceWallet: walletAddress },
      });

      if (user.consensusAutoMint) {
        const result = await executeConsensusCopyMint({
          userId: user.id,
          collection,
          chain,
        });
        await trackAnalyticsEvent({
          userId: user.id,
          eventType: 'whale_consensus_mint',
          status: result.success ? 'success' : 'failed',
          metadata: { collection, walletCount, confidence, taskId: 'taskId' in result ? result.taskId : undefined },
        });
      }

      notifications.push(user.id);
    }

    return { triggered: notifications.length > 0, walletCount, weightedScore: weightedConsensus.weightedScore, confidence, users: notifications };
  } catch (error) {
    await captureException(error, {
      area: 'whale-consensus',
      context: {
        wallet: input.walletAddress,
        collection: input.collection,
        chain: input.chain,
        transactionHash: input.transactionHash,
      },
      fingerprint: ['whale-consensus', 'record-event'],
    });
    throw error;
  }
}

export async function executeConsensusCopyMint(params: {
  userId: string;
  collection: string;
  chain?: Chain;
}) {
  try {
    const collection = normalizeAddress(params.collection);
    const chain = params.chain ?? 'ethereum';
    if (!isValidAddress(collection)) throw new Error('Invalid collection address');

    const wallet = await loadDefaultMintWallet(params.userId, chain);
    if (!wallet) {
      await captureMessage('Consensus copy mint missing wallet', {
        area: 'whale-consensus',
        level: 'warning',
        context: { userId: params.userId, collection, chain },
        fingerprint: ['whale-consensus', 'missing-wallet'],
      });
      return { success: false, error: 'No mint wallet available' };
    }

    const [mintState, requirements] = await Promise.all([
      getMintState(collection, chain),
      fetchMintRequirements(collection, chain),
    ]);

    if (mintState.status !== 'LIVE') {
      return { success: false, error: `Mint not live: ${mintState.status}` };
    }

    const [task] = await getDb()
      .insert(mintTasks)
      .values({
        userId: params.userId,
        walletId: wallet.id,
        quantity: 1,
        status: 'ready',
        contractAddress: collection,
        mintFunction: requirements.mintFunction,
        mintPrice: requirements.mintPrice,
      })
      .returning();

    await logActivity(params.userId, 'task_created', 'Consensus copy mint task created', {
      taskId: task.id,
      collection,
      chain,
    });

    const result = await executeMintTask(task.id, params.userId);
    return { ...result, taskId: task.id };
  } catch (error) {
    await captureException(error, {
      area: 'whale-consensus',
      context: { userId: params.userId, collection: params.collection, chain: params.chain },
      fingerprint: ['whale-consensus', 'copy-mint'],
    });
    throw error;
  }
}
