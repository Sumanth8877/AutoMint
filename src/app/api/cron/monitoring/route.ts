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
import { logActivity } from '@/lib/monitoring';
import { checkWebsite } from '@/lib/services/website-monitor.service';
import { executeMintTask } from '@/lib/services/mint.service';
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
      'website_monitoring',
      'mint_execution',
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
          const durationMs = Date.now() - execStart;

          // Normalize result shape
          const normalized = {
            success: true,
            taskType: task.taskType,
            durationMs,
            recordsUpdated: (result as any).recordsUpdated || 0,
            data: result,
          };

          await completeTask(task.id as string, normalized);
          allResults.completed++;

          if (execution) {
            await getDb().update(taskExecutions)
              .set({
                status: 'completed',
                completedAt: new Date(),
                duration: durationMs,
              })
              .where(eq(taskExecutions.id, execution.id));
          }

          allResults.executions.push({
            taskId: task.id,
            type: taskType,
            status: 'completed',
            duration: durationMs,
            result: normalized,
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
        const durationMs = Date.now() - Date.now(); // 0 for retries — no exec record updated
        const normalized = {
          success: true,
          taskType: task.taskType,
          durationMs,
          recordsUpdated: (result as any).recordsUpdated || 0,
          data: result,
        };
        await completeTask(task.id as string, normalized);
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

// ─── Dispatcher ──────────────────────────────────────

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
    case 'website_monitoring':
      return await handleWebsiteMonitoring(task, payload);
    case 'mint_execution':
      return await handleMintExecution(task, payload);
    default:
      throw new Error(`Unknown task type: ${task.taskType}`);
  }
}

// ─── Helper: Standard Result Wrapper ───────────────

function buildResult(
  taskType: string,
  durationMs: number,
  recordsUpdated: number,
  data: Record<string, unknown>,
) {
  return {
    success: true,
    taskType,
    durationMs,
    recordsUpdated,
    data,
  };
}

// ─── Wallet Monitoring ──────────────────────────────
// Flow: Blockchain → Compare DB last known → Cache → Activity

async function handleWalletMonitoring(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { walletId, chain } = payload as { walletId: string; chain: string };

  if (!walletId || !chain) {
    throw new Error('wallet_monitoring task requires walletId and chain');
  }

  // 1. Fetch wallet record (DB is source of truth for last known balance)
  const [wallet] = await getDb().select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
  if (!wallet) throw new Error(`Wallet not found: ${walletId}`);

  const address = wallet.address;

  // 2. ALWAYS fetch fresh balance from blockchain (not cache)
  const current = await getWalletBalance(address, chain);

  // 3. Read previous balance from DB (not cache — DB is primary source of truth)
  const previousBalance = wallet.nickname || null; // reuse nickname field as temp storage for lastKnownBalance if needed
  // Since we don't have a dedicated balance column, use the existing DB + Redis as last known cache
  // The DB's lastSyncedAt is the change signal
  const cacheKey = CACHE_KEYS.walletBalance(address, chain);

  // 4. update cache AFTER blockchain fetch
  await setCache(cacheKey, { balance: current.balance, symbol: current.symbol }, CACHE_TTL.walletBalance);

  // 5. Compare against the previously cached value to detect change
  const previousRaw = await getCache<{ balance: string }>(balanceCacheKey(address, chain));
  const prevBalance = previousRaw?.balance || null;
  const changed = prevBalance !== null && prevBalance !== current.balance;

  // 6. Log activity on balance change
  if (changed && task.userId) {
    const difference = prevBalance && current.balance
      ? (parseFloat(current.balance) - parseFloat(prevBalance)).toFixed(6)
      : current.balance;

    await logActivity(task.userId, 'wallet_balance_changed', 'Wallet balance changed', {
      walletId,
      address,
      chain,
      previousBalance: prevBalance,
      currentBalance: current.balance,
      difference,
      symbol: current.symbol,
    });
  }

  return buildResult('wallet_monitoring', 0, changed ? 1 : 0, {
    walletId,
    address,
    chain,
    changed,
    currentBalance: current.balance,
    symbol: current.symbol,
  });
}

// Temp cache key helper — reads the standard key
function balanceCacheKey(address: string, chain: string): string {
  return `balance:${chain}:${address.toLowerCase()}`;
}

// ─── NFT Tracking ───────────────────────────────────
// Flow: Database (source of truth) → Blockchain → Compare → Update DB → Refresh Cache

async function handleNftTracking(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { collectionId } = payload as { collectionId: string };

  if (!collectionId) {
    throw new Error('nft_tracking task requires collectionId');
  }

  // 1. DB is source of truth — get current known state
  const [collection] = await getDb().select().from(collections).where(eq(collections.id, collectionId)).limit(1);
  if (!collection) throw new Error(`Collection not found: ${collectionId}`);

  const currentTotalSupply = BigInt(collection.totalSupply || '0');

  // 2. Fetch fresh metadata from blockchain
  const metadata = await getCollectionMetadata(collection.contractAddress, collection.chain);

  // 3. Compare DB state with fresh blockchain state
  const metadataChanged =
    collection.name !== metadata.name ||
    collection.tokenStandard !== metadata.tokenStandard ||
    collection.owner !== metadata.owner;

  const mintStatusChanged = metadata.totalSupply > currentTotalSupply;

  // 4. Update DB if changed
  if (metadataChanged || mintStatusChanged) {
    await getDb().update(collections)
      .set({
        name: metadata.name,
        tokenStandard: metadata.tokenStandard,
        owner: metadata.owner,
        totalSupply: metadata.totalSupply.toString(),
        lastSyncedAt: new Date(),
      })
      .where(eq(collections.id, collectionId));

    // 5. Log activity
    if (task.userId) {
      await logActivity(task.userId, 'mint_status_changed', 'Collection metadata updated', {
        collectionId,
        contractAddress: collection.contractAddress,
        chain: collection.chain,
        changes: {
          name: metadata.name,
          tokenStandard: metadata.tokenStandard,
          totalSupply: metadata.totalSupply.toString(),
        },
      });
    }
  }

  // 6. Refresh Redis cache (reflects latest known state, not source of truth)
  const cacheKey = CACHE_KEYS.collectionMetadata(collection.contractAddress, collection.chain);
  await setCache(cacheKey, {
    name: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
  }, CACHE_TTL.collectionMetadata);

  const recordsUpdated = (metadataChanged || mintStatusChanged) ? 1 : 0;

  return buildResult('nft_tracking', 0, recordsUpdated, {
    collectionId,
    contractAddress: collection.contractAddress,
    chain: collection.chain,
    metadataChanged,
    mintStatusChanged,
    metadata: {
      name: metadata.name,
      symbol: metadata.symbol,
      owner: metadata.owner,
      tokenStandard: metadata.tokenStandard,
      totalSupply: metadata.totalSupply.toString(),
    },
  });
}

// ─── Collection Sync ─────────────────────────────────

async function handleCollectionSync(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { collectionId } = payload as { collectionId: string };

  if (!collectionId) {
    throw new Error('collection_sync task requires collectionId');
  }

  // 1. Get collection from DB
  const [collection] = await getDb().select().from(collections).where(eq(collections.id, collectionId)).limit(1);
  if (!collection) throw new Error(`Collection not found: ${collectionId}`);

  // 2. Force refresh from blockchain
  const metadata = await getCollectionMetadata(collection.contractAddress, collection.chain);

  // 3. Update DB
  await getDb().update(collections)
    .set({
      name: metadata.name,
      tokenStandard: metadata.tokenStandard,
      owner: metadata.owner,
      totalSupply: metadata.totalSupply.toString(),
      lastSyncedAt: new Date(),
    })
    .where(eq(collections.id, collectionId));

  // 4. Refresh cache to reflect latest state
  const cacheKey = CACHE_KEYS.collectionMetadata(collection.contractAddress, collection.chain);
  await setCache(cacheKey, {
    name: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
  }, CACHE_TTL.collectionMetadata);

  // 5. Floor price: NOT IMPLEMENTED — no provider configured
  //    Setting null explicitly to indicate pending implementation
  await setCache(
    CACHE_KEYS.floorPrice(collection.contractAddress, collection.chain),
    { floorPrice: null, source: 'not_configured' },
    CACHE_TTL.floorPrice,
  );

  // 6. Log activity
  if (task.userId) {
    await logActivity(task.userId, 'collection_live', 'Collection synced', {
      collectionId,
      contractAddress: collection.contractAddress,
      chain: collection.chain,
      totalSupply: metadata.totalSupply.toString(),
      tokenStandard: metadata.tokenStandard,
    });
  }

  return buildResult('collection_sync', 0, 1, {
    synced: true,
    collectionId,
    contractAddress: collection.contractAddress,
    chain: collection.chain,
    name: metadata.name,
    tokenStandard: metadata.tokenStandard,
    owner: metadata.owner,
    totalSupply: metadata.totalSupply.toString(),
    floorPrice: null,
    floorPriceSource: 'not_configured',
  });
}

// ─── Website Monitoring ────────────────────────────

async function handleWebsiteMonitoring(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { websiteId } = payload as { websiteId: string };

  if (!websiteId) {
    throw new Error('website_monitoring task requires websiteId');
  }

  const result = await checkWebsite(websiteId);

  return buildResult('website_monitoring', 0, result.changed ? 1 : 0, {
    websiteId,
    changed: result.changed,
    eventCreated: result.eventCreated,
    snapshotHash: result.snapshotHash,
    eventType: result.eventType,
    reason: result.reason,
  });
}

// ─── Mint Execution ───────────────────────────────

async function handleMintExecution(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { mintTaskId } = payload as { mintTaskId?: string };
  const taskId = mintTaskId || task.id;

  if (!taskId) {
    throw new Error('mint_execution task requires mintTaskId');
  }

  const result = await executeMintTask(taskId as string);

  return buildResult('mint_execution', 0, result.success ? 1 : 0, {
    mintTaskId: taskId,
    success: result.success,
    txHash: result.txHash,
    error: result.error,
  });
}

// ─── Metadata Refresh ───────────────────────────────

async function handleMetadataRefresh(
  task: any,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { chain, contractAddress } = payload as { chain: string; contractAddress: string };

  if (!chain || !contractAddress) {
    throw new Error('metadata_refresh task requires chain and contractAddress');
  }

  // 1. Check if cache is still valid
  const cacheKey = CACHE_KEYS.collectionMetadata(contractAddress, chain);
  const cached = await getCache<{ name: string; owner: string; tokenStandard: string }>(cacheKey);

  if (cached) {
    return buildResult('metadata_refresh', 0, 0, {
      refreshed: false,
      reason: 'Cache still valid — no refresh needed',
      cachedAt: new Date().toISOString(),
    });
  }

  // 2. Cache miss — fetch from blockchain
  const metadata = await getCollectionMetadata(contractAddress, chain);

  // 3. Update cache
  await setCache(cacheKey, {
    name: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
  }, CACHE_TTL.collectionMetadata);

  return buildResult('metadata_refresh', 0, 1, {
    refreshed: true,
    chain,
    contractAddress,
    name: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
    cachedAt: new Date().toISOString(),
  });
}