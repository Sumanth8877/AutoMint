/**
 * nonce-allocator.service.ts
 *
 * Distributed nonce allocator for concurrent EVM mint execution.
 *
 * Problem: Viem resolves nonce via eth_getTransactionCount('pending') when no
 * explicit nonce is provided. Multiple concurrent workers for the same wallet
 * call this RPC simultaneously and receive the same value, producing collisions.
 *
 * Solution: A Redis-backed allocator that:
 *   1. Acquires a short slot lock (held for < 300ms — the RPC + write window only)
 *   2. Reads the Redis counter AND the chain pending nonce
 *   3. Uses max(chainPending, redisCounter + 1) to prevent gaps and drift
 *   4. Writes the allocated nonce to an inflight sorted set (score = epoch ms)
 *   5. Releases the lock — all workers then broadcast concurrently (no lock held)
 *   6. After broadcast: removes from inflight set and scans for stale entries
 *
 * Concurrency model:
 *   The slot lock serialises ONLY the 200ms allocation window.
 *   10 tasks allocate unique nonces in ~2 seconds, then all broadcast simultaneously.
 *   This is NOT wallet-level serialisation of mint execution.
 *
 * Gap recovery:
 *   If a worker crashes after allocation but before broadcast, the inflight entry
 *   ages past GAP_THRESHOLD_MS. The next call to scanAndFillGaps detects it and
 *   logs an error (L5 fix: this function itself does NOT re-sign or
 *   re-broadcast — it only surfaces gaps). The dead-task recovery job (separate
 *   logic in mint-recovery.service: tasks stuck in 'running' with no txHash) is
 *   what actually re-routes the task; it relies on the Vercel cron heartbeat
 *   (vercel.json `crons`) to run on a fixed schedule even if the QStash
 *   self-scheduling loop misses a tick.
 */

import 'server-only';

import { randomBytes } from 'node:crypto';
import { getRedisClient } from '@/lib/redis';
import { getClient } from '@/lib/blockchain/client';

// ─── Configuration ────────────────────────────────────────────────────────────

/** How long the slot lock is held at most (ms). Covers RPC + 2× Redis ops. */
const SLOT_LOCK_TTL_MS = 600;

/** Delay between slot-lock acquisition retries (ms). */
const SLOT_LOCK_RETRY_MS = 80;

/** Maximum number of slot-lock acquisition attempts before falling back to RPC. */
const SLOT_LOCK_MAX_RETRIES = 10;

/**
 * How old an inflight entry must be (ms) before it is considered a gap.
 * Must be >> typical broadcast round-trip (≤ 2 s) but << mint window (30 s).
 */
const GAP_THRESHOLD_MS = 15_000;

/**
 * Entries older than this (ms) are pruned from the inflight set during scans
 * to prevent unbounded growth. Should be >> confirmation timeout.
 */
const INFLIGHT_PRUNE_AGE_MS = 120_000;

// ─── Redis key builders ────────────────────────────────────────────────────────

export const NONCE_KEYS = {
  /**
   * Integer string: the last nonce allocated from this allocator.
   * Persists indefinitely (no TTL). Re-seeded from chain on Redis restart.
   */
  counter: (address: string, chain: string) =>
    `nonce:counter:${address.toLowerCase()}:${chain}`,

  /**
   * String token: slot mutex held for the allocation window only (≤ 600 ms).
   * TTL is set as part of SET NX — never persists if holder crashes.
   */
  lock: (address: string, chain: string) =>
    `nonce:lock:${address.toLowerCase()}:${chain}`,

  /**
   * Sorted set: members are nonce strings, scores are allocation epoch-ms.
   * Used for gap detection: stale members (old score, not yet removed) indicate
   * a nonce that was allocated but never broadcast.
   */
  inflight: (address: string, chain: string) =>
    `nonce:inflight:${address.toLowerCase()}:${chain}`,
} as const;

// ─── Slot lock helpers ─────────────────────────────────────────────────────────

function makeToken(): string {
  return randomBytes(16).toString('hex');
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Acquire the wallet slot lock.
 * Returns the lock token on success, null if all retries are exhausted.
 */
async function acquireSlotLock(address: string, chain: string): Promise<string | null> {
  const key = NONCE_KEYS.lock(address, chain);
  const token = makeToken();
  const redis = getRedisClient();

  for (let attempt = 0; attempt < SLOT_LOCK_MAX_RETRIES; attempt++) {
    // SET key token PX ttl NX — atomic, single command
    const result = await redis.set(key, token, {
      px: SLOT_LOCK_TTL_MS,
      nx: true,
    });

    // Upstash returns "OK" on success, null on NX-rejected SET
    if (result === 'OK') {
      return token;
    }

    await sleep(SLOT_LOCK_RETRY_MS);
  }

  return null;
}

/**
 * Release the slot lock using an atomic Lua check-and-delete.
 * If the lock has already expired and another worker owns it, this is a no-op.
 */
async function releaseSlotLock(
  address: string,
  chain: string,
  token: string,
): Promise<void> {
  const key = NONCE_KEYS.lock(address, chain);
  const redis = getRedisClient();

  // Lua script: atomic GET → compare → DEL (Redlock pattern)
  const luaScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  try {
    await (redis as unknown as { eval: (script: string, keys: string[], args: string[]) => Promise<unknown> }).eval(luaScript, [key], [token]);
  } catch (error) {
    // Non-fatal: the lock will expire on its own via TTL
  }
}

// ─── Chain nonce reader ────────────────────────────────────────────────────────

/**
 * Returns eth_getTransactionCount(address, 'pending').
 * 'pending' = confirmed + mempool. This is the correct floor for new nonces.
 */
async function getChainPendingNonce(address: string, chain: string): Promise<number> {
  const client = getClient(chain);
  const count = await client.getTransactionCount({
    address: address as `0x${string}`,
    blockTag: 'pending',
  });
  return Number(count);
}

// ─── Public API ────────────────────────────────────────────────────────────────

export type AllocateNonceResult =
  | { success: true; nonce: number; source: 'allocator' }
  | { success: false; nonce: number; source: 'rpc-fallback' };

/**
 * Allocate the next unique nonce for (address, chain).
 *
 * Guarantees:
 *   - No two concurrent calls for the same (address, chain) return the same nonce.
 *   - The slot lock is released BEFORE this function returns — callers broadcast concurrently.
 *   - On Redis failure, falls back to RPC (same as current behaviour; degrades gracefully).
 *
 * After calling this, you MUST call releaseInflightNonce() after sendTransaction completes
 * (success or known failure). Do not silently swallow it.
 */
export async function allocateNonce(
  address: string,
  chain: string,
): Promise<AllocateNonceResult> {
  const redis = getRedisClient();
  const counterKey = NONCE_KEYS.counter(address, chain);
  const inflightKey = NONCE_KEYS.inflight(address, chain);

  const lockToken = await acquireSlotLock(address, chain);

  if (!lockToken) {
    // M-2 fix: reduce collision probability in the fallback path.
    // When two workers exhaust the lock retries simultaneously they both call
    // getChainPendingNonce() and receive the same value — a nonce collision.
    // A small random jitter (0–150 ms) desynchronises the two RPC calls so
    // they are unlikely to both land on the same pending nonce value.
    // This does not fully eliminate the race but reduces it significantly.
    // The proper fix is to never exhaust the lock — tune SLOT_LOCK_MAX_RETRIES
    // or SLOT_LOCK_TTL_MS if fallbacks are occurring frequently (monitor logs).
    await sleep(Math.floor(Math.random() * 150));

    const rpcNonce = await getChainPendingNonce(address, chain);
    return { success: false, nonce: rpcNonce, source: 'rpc-fallback' };
  }

  try {
    // Step 2: Read Redis counter (null if key does not exist)
    const counterRaw = await redis.get<string>(counterKey);
    const redisCounter = counterRaw !== null ? Number(counterRaw) : null;

    // Step 3: Read chain pending nonce
    const chainPendingNonce = await getChainPendingNonce(address, chain);

    // Step 4: Compute next nonce
    //
    // Case A — chainPendingNonce > redisCounter (or counter is null):
    //   The chain is ahead of Redis. This happens after:
    //     - Redis restart (counter was wiped)
    //     - External transactions from the same wallet
    //     - A gap was filled and chain moved past Redis counter
    //   Use chain as the authoritative base.
    //
    // Case B — redisCounter >= chainPendingNonce:
    //   Redis is ahead of the chain. This is the normal concurrent case
    //   where allocated nonces are in the mempool but not yet confirmed.
    //   Continue incrementing from Redis to preserve the in-flight sequence.
    //
    let nextNonce: number;
    if (redisCounter === null || chainPendingNonce > redisCounter) {
      nextNonce = chainPendingNonce;
    } else {
      nextNonce = redisCounter + 1;
    }

    // Steps 5+6: Persist counter and mark inflight in a single pipeline round-trip.
    // @upstash/redis 1.30+ pipelines are atomic from the client's perspective —
    // both commands are sent in one HTTP request, halving latency vs two awaits.
    const epochMs = Date.now();
    // C-04 Fix: add a TTL to the nonce counter key.
    //
    // Previously the counter had no TTL so it persisted indefinitely. If the
    // wallet was used externally (e.g. via MetaMask) the on-chain nonce would
    // advance but the Redis counter would lag, causing the allocator to produce
    // sub-chain-pending nonces. max(chainPending, redisCounter+1) prevents
    // immediate collision, but the counter grows permanently out of sync.
    //
    // With a 5-minute TTL: if no mint runs for 5 minutes, the key expires and
    // the next allocation re-seeds from eth_getTransactionCount('pending'),
    // eliminating drift without affecting concurrent high-frequency mints
    // (each allocation resets the TTL via EX on SET, keeping the key alive).
    const COUNTER_TTL_SECONDS = 5 * 60; // 5 minutes
    const pipeline = redis.pipeline();
    pipeline.set(counterKey, String(nextNonce), { ex: COUNTER_TTL_SECONDS });
    pipeline.zadd(inflightKey, { score: epochMs, member: String(nextNonce) });
    await pipeline.exec();

    return { success: true, nonce: nextNonce, source: 'allocator' };
  } finally {
    // Step 7: Always release the slot lock — even if allocation threw
    await releaseSlotLock(address, chain, lockToken);
  }
}

/**
 * Remove a nonce from the inflight set after it has been broadcast (or definitively failed).
 * Must be called after every sendTransaction(), success or failure.
 *
 * Failure to call this will cause the nonce to appear as a gap candidate after
 * GAP_THRESHOLD_MS and log an error.
 */
export async function releaseInflightNonce(
  address: string,
  chain: string,
  nonce: number,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.zrem(NONCE_KEYS.inflight(address, chain), String(nonce));
  } catch (error) {
    // Non-fatal. The nonce will be treated as a gap candidate and investigated.
    // Do not rethrow — the transaction has already been broadcast.
  }
}

/**
 * Scan the inflight set for nonces older than GAP_THRESHOLD_MS.
 *
 * For each candidate:
 *   1. Verify the nonce is genuinely missing from the chain/mempool.
 *   2. If confirmed (chain moved past it) — stale entry, clean up.
 *   3. If genuinely missing — log the error. NOTE: this function itself
 *      does NOT re-sign or rebroadcast. The dead-task recovery job (which
 *      already detects tasks stuck in 'running' with no txHash > 10 min) is
 *      what actually re-routes the task using DB-stored parameters.
 *
 * Fire-and-forget: call with `void scanAndFillGaps(...)` after each broadcast.
 * Non-blocking — adds ~5–30ms in the background, does not affect mint latency.
 */
export async function scanAndFillGaps(
  address: string,
  chain: string,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const inflightKey = NONCE_KEYS.inflight(address, chain);

    const now = Date.now();
    const gapThreshold = now - GAP_THRESHOLD_MS;
    const pruneThreshold = now - INFLIGHT_PRUNE_AGE_MS;

    // Remove entries that are very old (pruning, not gap recovery)
    await redis.zremrangebyscore(inflightKey, 0, pruneThreshold);

    // Find entries that have been inflight longer than the gap threshold
    const staleMembers = await redis.zrange(inflightKey, 0, gapThreshold, { byScore: true });

    if (staleMembers.length === 0) return;

    const staleNonces = staleMembers.map(Number);

    // For each stale nonce, verify against chain state
    for (const staleNonce of staleNonces) {
      await investigateStaleNonce(address, chain, staleNonce);
    }
  } catch (error) {
    // Scan failure is non-fatal. Gap detection will retry on next broadcast.
  }
}

async function investigateStaleNonce(
  address: string,
  chain: string,
  nonce: number,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const inflightKey = NONCE_KEYS.inflight(address, chain);

    const chainPending = await getChainPendingNonce(address, chain);

    if (chainPending > nonce) {
      // Nonce is confirmed or in mempool. Stale inflight entry — clean up.
      await redis.zrem(inflightKey, String(nonce));
      return;
    }

    // Nonce is genuinely missing from mempool.
    // Reliability fix (R-2): previously this only fired a error log with a hint
    // to run a manual recovery query. Now we trigger the recovery job directly so
    // the stuck task is found and re-executed automatically.

    // Trigger the recovery job immediately — best-effort, non-blocking.
    // recoverStuckMintTasks() will find any task stuck in 'running' with no txHash
    // for this wallet and re-schedule it via QStash.
    void (async () => {
      try {
        const { recoverStuckMintTasks } = await import('@/lib/services/mint-recovery.service');
        await recoverStuckMintTasks();
      } catch {
        // Non-fatal — error logged above already notifies; recovery will
        // also run on the next scheduled recovery check.
      }
    })();
  } catch (error) {
  }
}

// ─── Admin / Recovery ──────────────────────────────────────────────────────────

/**
 * Force-reset the Redis counter to (chainPendingNonce - 1).
 * Call this after manually filling a gap or when the counter has drifted
 * far ahead of on-chain state.
 *
 * Also clears all inflight entries for this wallet+chain.
 */
export async function resetNonceCounter(address: string, chain: string): Promise<number> {
  const redis = getRedisClient();
  const chainPendingNonce = await getChainPendingNonce(address, chain);

  // Seed counter and clear inflight in one pipeline round-trip (@upstash/redis 1.30+)
  const resetPipeline = redis.pipeline();
  resetPipeline.set(NONCE_KEYS.counter(address, chain), String(chainPendingNonce - 1));
  resetPipeline.del(NONCE_KEYS.inflight(address, chain));
  await resetPipeline.exec();

  return chainPendingNonce;
}

/**
 * Returns the current nonce allocator status for a wallet+chain.
 * Used by the health check endpoint and the infra test suite.
 */
export async function getNonceStatus(
  address: string,
  chain: string,
): Promise<{
  redisCounter: number | null;
  chainPending: number;
  inflightCount: number;
  inflightNonces: number[];
}> {
  const redis = getRedisClient();

  const [counterRaw, chainPending, inflightMembers] = await Promise.all([
    redis.get<string>(NONCE_KEYS.counter(address, chain)),
    getChainPendingNonce(address, chain),
    redis.zrange(NONCE_KEYS.inflight(address, chain), 0, '+inf', { byScore: true }),
  ]);

  return {
    redisCounter: counterRaw !== null ? Number(counterRaw) : null,
    chainPending,
    inflightCount: inflightMembers.length,
    inflightNonces: inflightMembers.map(Number),
  };
}
