import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { acquireCronLock, releaseCronLock } from '@/lib/redis/lock';
import { getCache, setCache, CACHE_KEYS, CACHE_TTL } from '@/lib/redis';
import { claimPendingTasks, completeTask, failTask, getDueRetryTasks } from '@/lib/services/task.service';
import { getDb } from '@/lib/db';
import { taskExecutions } from '@/drizzle/schema/monitoring';
import { wallets } from '@/drizzle/schema';
import { collections } from '@/drizzle/schema';
import { getWalletBalance } from '@/lib/blockchain/wallet';
import { getCollectionMetadata } from '@/lib/blockchain/collections';
import { logActivity, getRecentActivities } from '@/lib/monitoring';
import type { TaskType } from '@/lib/services/task.service';

const CRON_SECRET = process.env.CRON_SECRET || '';
const LOCK_TTL = 55;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const lockAcquired = await acquireCronLock('monitoring', LOCK_TTL);
  if (!lockAcquired) {
    return NextResponse.json({
      success: false,
      reason: 'Cron lock held by another execution — skipped',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const allResults: Record<string, any> = {
      clock: new Date().toISOString(),
      claimed: 0,
      completed: 0,
      failed: 0,
      retriesProcessed: 0,
      executions: [],
    };

    const taskTypes: TaskType[] = [
      'wallet_monitoring',
      'nft_tracking',
      'collection_sync',
      'metadata_refresh',
    ];

    for (const taskType of taskTypes) {
      const claimed = await claimPendingTasks(taskType, 3);
      allResults.claimed += claimed.length;

      for (const task of claimed) {
        const execStart = Date.now();
        const attemptNumber = (Number(task.attempts) || 0) + 1;

        try {
          const [execution] = await getDb().insert(taskExecutions).values({
            taskId: task.id as string,
            attemptNumber,
            status: 'running',
          }).returning();

          const result = await processTaskByType(task);

          await completeTask(task.id as string, result);
          allResults.completed++;

          if (execution) {
            await getDb().update(taskExecutions)
              .set({
                status: 'completed',
                completedAt: new Date(),
                duration: Date.now() - execStart,
              })
              .where(eq(taskExecutions.id, execution.id));
          }

          allResults.executions.push({
            taskId: task.id,
            type: taskType,
            status: 'completed',
            duration: Date.now() - execStart,
            result,
          });
        } catch (err: any) {
          await failTask(task.id as string, { message: err.message, type: taskType });
          allResults.failed++;

          allResults.executions.push({
            taskId: task.id,
            type: taskType,
            status: 'failed',
            error: err.message,
            duration: Date.now() - execStart,
          });
        }
      }
    }

    // Process due retries
    const dueRetries = await getDueRetryTasks(5);
    allResults.retriesProcessed = dueRetries.length;

    for (const task of dueRetries) {
      try {
        const result = await processTaskByType(task);
        await completeTask(task.id as string, result);
      } catch (err: any) {
        await failTask(task.id as string, { message: err.message, type: 'retry' });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results: allResults,
    });
  } finally {
    await releaseCronLock('monitoring');
  }
}

/**
 * Process a task based on its type.
 * Each handler must throw on failure (retry system catches it).
 * Each handler returns a typed result object.
 */
async function processTaskByType(task: any): Promise<Record<string, unknown>> {
  const payload = (task.payload as Record<string, unknown>) || {};

  switch (task.taskType) {
    case 'wallet_monitoring':
      return await handleWalletMonitoring(task, payload);
    case 'nft_tracking':
      return await handleNftTracking(task, payload);
    case 'collection_sync':
      return await handleCollectionSync(task, payload);
    case 'metadata_refresh':
      return await handleMetadataRefresh(task, payload);
    default:
      throw new Error(`Unknown task type: ${task.taskType}`);
  }
}

// ─── Wallet Monitoring Handler ───────────────────

async function handleWalletMonitoring(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { walletId, chain } = payload as { walletId: string; chain: string };

  if (!walletId || !chain) {
    throw new Error('wallet_monitoring task requires walletId and chain in payload');
  }

  // Fetch wallet record from DB
  const [wallet] = await getDb().select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
  if (!wallet) {
    throw new Error(`Wallet not found: ${walletId}`);
  }

  const address = wallet.address;
  const cacheKey = CACHE_KEYS.walletBalance(address, chain);
  const previousRaw = await getCache<{ balance: string; symbol: string }>(cacheKey);
  const previousBalance = previousRaw?.balance || null;

  // Fetch current balance from blockchain
  const current = await getWalletBalance(address, chain);
  const currentBalance = current.balance;

  // Cache the result
  await setCache(cacheKey, { balance: currentBalance, symbol: current.symbol }, CACHE_TTL.walletBalance);

  const changed = previousBalance !== null && previousBalance !== currentBalance;

  // Log activity if balance changed
  if (changed && task.userId) {
    await logActivity(task.userId, 'wallet_added', 'Wallet balance changed', {
      walletId,
      address,
      chain,
      previousBalance,
      currentBalance,
      symbol: current.symbol,
    });
  }

  return {
    success: true,
    walletId,
    address,
    chain,
    previousBalance,
    currentBalance,
    changed,
    symbol: current.symbol,
    cached: true,
  };
}

// ─── NFT Tracking Handler ────────────────────────

async function handleNftTracking(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { collectionId } = payload as { collectionId: string };

  if (!collectionId) {
    throw new Error('nft_tracking task requires collectionId in payload');
  }

  // Fetch collection from DB
  const [collection] = await getDb().select().from(collections).where(eq(collections.id, collectionId)).limit(1);
  if (!collection) {
    throw new Error(`Collection not found: ${collectionId}`);
  }

  const cacheKey = CACHE_KEYS.collectionMetadata(collection.contractAddress, collection.chain);
  const previousRaw = await getCache<{ name: string; owner: string; tokenStandard: string }>(cacheKey);

  // Fetch fresh metadata from blockchain
  const metadata = await getCollectionMetadata(collection.contractAddress, collection.chain);

  // Update cache
  await setCache(cacheKey, {
    name: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
  }, CACHE_TTL.collectionMetadata);

  // Detect changes
  const metadataChanged = !previousRaw ||
    previousRaw.name !== metadata.name ||
    previousRaw.owner !== metadata.owner ||
    previousRaw.tokenStandard !== metadata.tokenStandard;

  const ownershipChanged = previousRaw && previousRaw.owner !== metadata.owner;
  const mintStatusChanged = collection.mintStatus !== 'unknown' && metadata.totalSupply > BigInt(collection.totalSupply || '0');

  // Update collection record if metadata changed
  if (metadataChanged) {
    await getDb().update(collections)
      .set({
        name: metadata.name,
        tokenStandard: metadata.tokenStandard,
        owner: metadata.owner,
        totalSupply: metadata.totalSupply.toString(),
        lastSyncedAt: new Date(),
      })
      .where(eq(collections.id, collectionId));

    // Log activity
    if (task.userId) {
      await logActivity(task.userId, 'mint_status_changed', 'Collection metadata updated', {
        collectionId,
        contractAddress: collection.contractAddress,
        chain: collection.chain,
        changes: {
          name: metadata.name,
          owner: metadata.owner,
          tokenStandard: metadata.tokenStandard,
          totalSupply: metadata.totalSupply.toString(),
        },
      });
    }
  }

  return {
    success: true,
    collectionId,
    contractAddress: collection.contractAddress,
    chain: collection.chain,
    metadata: {
      name: metadata.name,
      symbol: metadata.symbol,
      owner: metadata.owner,
      tokenStandard: metadata.tokenStandard,
      totalSupply: metadata.totalSupply.toString(),
    },
    metadataChanged,
    ownershipChanged,
    mintStatusChanged,
    cached: true,
  };
}

// ─── Collection Sync Handler ─────────────────────

async function handleCollectionSync(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { collectionId } = payload as { collectionId: string };

  if (!collectionId) {
    throw new Error('collection_sync task requires collectionId in payload');
  }

  // Fetch collection from DB
  const [collection] = await getDb().select().from(collections).where(eq(collections.id, collectionId)).limit(1);
  if (!collection) {
    throw new Error(`Collection not found: ${collectionId}`);
  }

  // Fetch fresh metadata
  const metadata = await getCollectionMetadata(collection.contractAddress, collection.chain);

  // Update collection record
  await getDb().update(collections)
    .set({
      name: metadata.name,
      tokenStandard: metadata.tokenStandard,
      owner: metadata.owner,
      totalSupply: metadata.totalSupply.toString(),
      lastSyncedAt: new Date(),
    })
    .where(eq(collections.id, collectionId));

  // Update all cache entries
  const metaCacheKey = CACHE_KEYS.collectionMetadata(collection.contractAddress, collection.chain);
  await setCache(metaCacheKey, {
    name: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
  }, CACHE_TTL.collectionMetadata);

  const floorKey = CACHE_KEYS.floorPrice(collection.contractAddress, collection.chain);
  await setCache(floorKey, collection.floorPrice || '0', CACHE_TTL.floorPrice);

  // Log activity
  if (task.userId) {
    await logActivity(task.userId, 'collection_live', 'Collection synced', {
      collectionId,
      contractAddress: collection.contractAddress,
      chain: collection.chain,
      totalSupply: metadata.totalSupply.toString(),
      tokenStandard: metadata.tokenStandard,
    });
  }

  return {
    success: true,
    synced: true,
    collectionId,
    contractAddress: collection.contractAddress,
    chain: collection.chain,
    name: metadata.name,
    tokenStandard: metadata.tokenStandard,
    owner: metadata.owner,
    totalSupply: metadata.totalSupply.toString(),
    cached: true,
  };
}

// ─── Metadata Refresh Handler ────────────────────

async function handleMetadataRefresh(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { chain, contractAddress } = payload as { chain?: string; contractAddress?: string };
  const refreshed: Record<string, boolean> = {};

  if (!chain || !contractAddress) {
    throw new Error('metadata_refresh task requires chain and contractAddress in payload');
  }

  // Check if cache is still valid (use TTL from redis config)
  const cacheKey = CACHE_KEYS.collectionMetadata(contractAddress, chain);
  const cached = await getCache<{ name: string; owner: string; tokenStandard: string }>(cacheKey);

  if (cached) {
    return {
      success: true,
      refreshed: false,
      reason: 'Cache still valid — no refresh needed',
      cachedAt: new Date().toISOString(),
    };
  }

  // Cache miss or expired: fetch fresh data
  const metadata = await getCollectionMetadata(contractAddress, chain);

  await setCache(cacheKey, {
    name: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
  }, CACHE_TTL.collectionMetadata);

  refreshed[contractAddress] = true;

  return {
    success: true,
    refreshed: true,
    chain,
    contractAddress,
    name: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
    cachedAt: new Date().toISOString(),
  };
}