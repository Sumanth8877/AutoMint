import 'server-only';

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { copyMintRules, mintTasks, wallets } from '@/drizzle/schema';
import { logActivity } from '@/lib/monitoring';
import { executeMintTask } from '@/lib/services/mint.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { acquireLock, releaseLock } from '@/lib/services/mint-lock.service';
import { normalizeAddress, isValidEvmAddress } from '@/lib/utils/address';
import { getRedisClient } from '@/lib/redis';

type CopyMintEvent = {
  userId: string;
  watchedWalletAddress: string;
  chain: 'ethereum' | 'base' | 'polygon' | 'arbitrum';
  contractAddress: string;
  tokenId?: string;
  transactionHash?: string;
};

type CopyMintRuleInput = {
  walletAddress: string;
  maxPrice?: string | number | null;
  quantity?: string | number | null;
  riskThreshold?: string | number | null;
  destinationWalletId?: string | null;
  autoMint?: boolean;
  minMintCount?: string | number | null;
  enabled?: boolean;
};

function normalizeQuantity(quantity: string | number | null | undefined) {
  return Math.max(1, parseInt(String(quantity ?? '1'), 10) || 1);
}

function normalizeRiskThreshold(riskThreshold: string | number | null | undefined) {
  const value = parseInt(String(riskThreshold ?? '75'), 10);
  if (!Number.isFinite(value)) return 75;
  return Math.max(0, Math.min(100, value));
}

function normalizeMaxPrice(maxPrice: string | number | null | undefined) {
  if (maxPrice === null || maxPrice === undefined || maxPrice === '') return null;
  const value = Number(maxPrice);
  if (!Number.isFinite(value) || value < 0) throw new Error('maxPrice must be a positive number');
  return String(value);
}

function normalizeMinMintCount(minMintCount: string | number | null | undefined) {
  const value = parseInt(String(minMintCount ?? '1'), 10);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, value);
}

function parsePrice(value: string | null | undefined) {
  if (!value) return 0;
  const parsed = Number(String(value).match(/\d+(?:\.\d+)?/)?.[0] ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

async function sendCopyMintNotification(
  userId: string,
  type: 'copy_mint_triggered' | 'mint_success' | 'mint_failed',
  payload: {
    wallet?: string;
    contractAddress?: string;
    taskId?: string;
    txHash?: string;
    error?: string;
  },
) {
  const { sendTelegramNotification } = await import('@/lib/services/telegram.service');
  return sendTelegramNotification(userId, type, payload);
}

async function loadDefaultMintWallet(userId: string, chain: string, destinationWalletId?: string | null) {
  if (destinationWalletId) {
    const [destinationWallet] = await getDb()
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.id, destinationWalletId), eq(wallets.walletType, 'EVM')))
      .limit(1);

    if (destinationWallet) return destinationWallet;
  }

  const [sameChain] = await getDb()
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, chain as 'ethereum' | 'base' | 'polygon'), eq(wallets.walletType, 'EVM')))
    .orderBy(wallets.createdAt)
    .limit(1);

  if (sameChain) return sameChain;

  // Fallback: use any EVM wallet — log warning so caller knows chain may mismatch

  const [fallback] = await getDb()
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.walletType, 'EVM')))
    .orderBy(wallets.createdAt)
    .limit(1);

  if (fallback) {
  }

  return fallback ?? null;
}

async function normalizeDestinationWalletId(userId: string, destinationWalletId: string | null | undefined) {
  if (!destinationWalletId) return null;

  const [wallet] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.id, destinationWalletId)))
    .limit(1);

  if (!wallet) throw new Error('Destination wallet not found');
  return wallet.id;
}

export async function upsertCopyMintRule(userId: string, data: CopyMintRuleInput) {
  const walletAddress = normalizeAddress(data.walletAddress);
  if (!isValidEvmAddress(walletAddress)) throw new Error('Invalid wallet address');
  const destinationWalletId = await normalizeDestinationWalletId(userId, data.destinationWalletId);

  const [rule] = await getDb()
    .insert(copyMintRules)
    .values({
      userId,
      walletAddress,
      maxPrice: normalizeMaxPrice(data.maxPrice),
      quantity: normalizeQuantity(data.quantity),
      riskThreshold: normalizeRiskThreshold(data.riskThreshold),
      destinationWalletId,
      autoMint: data.autoMint ?? false,
      minMintCount: normalizeMinMintCount(data.minMintCount),
      enabled: data.enabled ?? true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [copyMintRules.userId, copyMintRules.walletAddress],
      set: {
        maxPrice: normalizeMaxPrice(data.maxPrice),
        quantity: normalizeQuantity(data.quantity),
        riskThreshold: normalizeRiskThreshold(data.riskThreshold),
        destinationWalletId,
        autoMint: data.autoMint ?? false,
        minMintCount: normalizeMinMintCount(data.minMintCount),
        enabled: data.enabled ?? true,
        updatedAt: new Date(),
      },
    })
    .returning();

  await logActivity(userId, 'mint_status_changed', 'Copy mint rule updated', {
    ruleId: rule.id,
    walletAddress,
    maxPrice: rule.maxPrice,
    quantity: rule.quantity,
    riskThreshold: rule.riskThreshold,
    destinationWalletId: rule.destinationWalletId,
    autoMint: rule.autoMint,
    enabled: rule.enabled,
  });

  return rule;
}

export async function getCopyMintRules(userId: string) {
  return getDb()
    .select()
    .from(copyMintRules)
    .where(eq(copyMintRules.userId, userId));
}

export async function updateCopyMintRule(userId: string, id: string, data: Partial<CopyMintRuleInput>) {
  const values: Partial<typeof copyMintRules.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (data.maxPrice !== undefined) values.maxPrice = normalizeMaxPrice(data.maxPrice);
  if (data.quantity !== undefined) values.quantity = normalizeQuantity(data.quantity);
  if (data.minMintCount !== undefined) values.minMintCount = normalizeMinMintCount(data.minMintCount);
  if (data.destinationWalletId !== undefined) values.destinationWalletId = await normalizeDestinationWalletId(userId, data.destinationWalletId);
  if (data.autoMint !== undefined) values.autoMint = data.autoMint;
  if (data.enabled !== undefined) values.enabled = data.enabled;

  const [rule] = await getDb()
    .update(copyMintRules)
    .set(values)
    .where(and(eq(copyMintRules.userId, userId), eq(copyMintRules.id, id)))
    .returning();

  if (!rule) throw new Error('Copy mint rule not found');
  await logActivity(userId, 'mint_status_changed', 'Copy mint rule updated', {
    ruleId: rule.id,
    walletAddress: rule.walletAddress,
    maxPrice: rule.maxPrice,
    quantity: rule.quantity,
    riskThreshold: rule.riskThreshold,
    autoMint: rule.autoMint,
    enabled: rule.enabled,
  });

  return rule;
}

export async function deleteCopyMintRule(userId: string, id: string) {
  const [rule] = await getDb()
    .delete(copyMintRules)
    .where(and(eq(copyMintRules.userId, userId), eq(copyMintRules.id, id)))
    .returning();

  if (!rule) throw new Error('Copy mint rule not found');
  await logActivity(userId, 'mint_status_changed', 'Copy mint rule deleted', {
    ruleId: rule.id,
    walletAddress: rule.walletAddress,
  });

  return rule;
}

async function findRule(userId: string, walletAddress: string) {
  const [rule] = await getDb()
    .select()
    .from(copyMintRules)
    .where(and(
      eq(copyMintRules.userId, userId),
      eq(copyMintRules.walletAddress, normalizeAddress(walletAddress)),
      eq(copyMintRules.enabled, true),
    ))
    .limit(1);

  return rule ?? null;
}

function priceAllowed(mintPrice: string | null | undefined, maxPrice: string | null) {
  if (!maxPrice) return true;
  return parsePrice(mintPrice) <= parsePrice(maxPrice);
}

export async function handleCopyMintEvent(event: CopyMintEvent) {
  try {
  const contractAddress = normalizeAddress(event.contractAddress);
  if (!isValidEvmAddress(contractAddress)) {
    return { status: 'skipped' as const, reason: 'invalid_contract' };
  }

  const rule = await findRule(event.userId, event.watchedWalletAddress);
  if (!rule) {
    return { status: 'skipped' as const, reason: 'no_enabled_rule' };
  }

  // H-5 fix: lock key uses only userId+ruleId+contractAddress.
  // Including transactionHash caused different Alchemy webhook retries
  // (same contract, different txHash) to bypass the lock and create duplicate tasks.
  const lockName = `copy-mint:${event.userId}:${rule.id}:${contractAddress}`;
  // H1 fix: capture the token so releaseLock uses the atomic Lua CAS path.
  const lockToken = (await acquireLock(lockName)) ?? undefined;
  if (!lockToken) {
    return { status: 'skipped' as const, reason: 'locked' };
  }

  try {

    // ── Min Mint Count Gate ──────────────────────────────────────────────
    // If the rule requires the whale to mint N+ times in the same collection
    // before triggering, count mints using a Redis counter with a 24h rolling window.
    if (rule.minMintCount > 1) {
      try {
        const redis = getRedisClient();
        const countKey = `copy-mint-count:${event.watchedWalletAddress}:${contractAddress}`;
        const currentCount = await redis.incr(countKey);
        // Set 24h TTL on first increment
        if (currentCount === 1) {
          await redis.expire(countKey, 86_400);
        }

        if (currentCount < rule.minMintCount) {
          await logActivity(event.userId, 'mint_status_changed', `Copy mint waiting: ${currentCount}/${rule.minMintCount} mints by whale`, {
            ruleId: rule.id,
            contractAddress,
            currentCount,
            requiredCount: rule.minMintCount,
          });
          return { status: 'skipped' as const, reason: `mint_count_below_threshold:${currentCount}/${rule.minMintCount}` };
        }

      } catch {
        // Redis error — fail-open and proceed with copy-mint evaluation
      }
    }

    const [mintState, requirements] = await Promise.all([
      getMintState(contractAddress, event.chain),
      fetchMintRequirements(contractAddress, event.chain),
    ]);

    if (mintState.status !== 'LIVE' && mintState.status !== 'ACTIVE') {
      await logActivity(event.userId, 'mint_status_changed', 'Copy mint skipped: mint unavailable', {
        ruleId: rule.id,
        contractAddress,
        mintStatus: mintState.status,
      });
      return { status: 'skipped' as const, reason: `mint_not_live:${mintState.status}` };
    }

    if (requirements.isSoldOut) {
      await logActivity(event.userId, 'mint_status_changed', 'Copy mint skipped: collection sold out', {
        ruleId: rule.id,
        contractAddress,
      });
      return { status: 'skipped' as const, reason: 'sold_out' };
    }

    if (!priceAllowed(requirements.mintPrice, rule.maxPrice)) {
      await logActivity(event.userId, 'mint_status_changed', 'Copy mint skipped: price too high', {
        ruleId: rule.id,
        contractAddress,
        mintPrice: requirements.mintPrice,
        maxPrice: rule.maxPrice,
      });
      await sendCopyMintNotification(event.userId, 'mint_failed', {
        wallet: event.watchedWalletAddress,
        contractAddress,
        error: 'Copy mint price exceeds rule maxPrice',
      });
      return { status: 'skipped' as const, reason: 'price_exceeds_rule' };
    }

    await sendCopyMintNotification(event.userId, 'copy_mint_triggered', {
      wallet: event.watchedWalletAddress,
      contractAddress,
    });
    const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
    await trackAnalyticsEvent({
      userId: event.userId,
      eventType: 'copy_mint',
      status: 'triggered',
      metadata: { wallet: event.watchedWalletAddress, contractAddress, ruleId: rule.id },
    });

    if (!rule.autoMint) {
      await logActivity(event.userId, 'mint_status_changed', 'Copy mint detected; auto mint disabled', {
        ruleId: rule.id,
        contractAddress,
      });
      return { status: 'skipped' as const, reason: 'auto_mint_disabled' };
    }

    const wallet = await loadDefaultMintWallet(event.userId, event.chain, rule.destinationWalletId);
    if (!wallet) {
      await sendCopyMintNotification(event.userId, 'mint_failed', {
        wallet: event.watchedWalletAddress,
        contractAddress,
        error: 'No AutoMint wallet available for copy mint',
      });
      return { status: 'skipped' as const, reason: 'no_mint_wallet' };
    }

    const [task] = await getDb()
      .insert(mintTasks)
      .values({
        userId: event.userId,
        walletId: wallet.id,
        quantity: rule.quantity,
        status: 'ready',
        contractAddress,
        mintFunction: requirements.mintFunction,
        mintPrice: requirements.mintPrice,
      })
      .returning();

    await logActivity(event.userId, 'task_created', 'Copy mint task created', {
      taskId: task.id,
      ruleId: rule.id,
      sourceWallet: event.watchedWalletAddress,
      contractAddress,
      quantity: rule.quantity,
    });

    const result = await executeMintTask(task.id, event.userId);
    if (result.success) {
      await sendCopyMintNotification(event.userId, 'mint_success', {
        wallet: event.watchedWalletAddress,
        contractAddress,
        taskId: task.id,
        txHash: result.txHash,
      });
      return { status: 'completed' as const, taskId: task.id, txHash: result.txHash };
    }

    await sendCopyMintNotification(event.userId, 'mint_failed', {
      wallet: event.watchedWalletAddress,
      contractAddress,
      taskId: task.id,
      error: result.error,
    });
    return { status: 'failed' as const, taskId: task.id, error: result.error };
  } finally {
    await releaseLock(lockName, lockToken);
  }
  } catch (error) {
    throw error;
  }
}
