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
 *   ages past GAP_THRESHOLD_MS. The next call to scanAndFillGaps detects it,
 *   verifies against on-chain state, and records a Sentry alert so the dead-task
 *   recovery job (existing logic: tasks stuck in 'running' with no txHash) can
 *   re-sign and rebroadcast using the original task parameters stored in the DB.
 */

import 'server-only';

import { randomBytes } from 'node:crypto';
import { getRedisClient } from '@/lib/redis';
import { getClient } from '@/lib/blockchain/client';
import {
  addBreadcrumb,
  captureException,
  captureMessage,
} from '@/lib/observability/sentry';

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
      addBreadcrumb({
        category: 'nonce-allocator',
        message: 'Slot lock acquired',
        level: 'info',
        data: { address, chain, attempt },
      });
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
    await (redis as any).eval(luaScript, [key], [token]);
  } catch (error) {
    // Non-fatal: the lock will expire on its own via TTL
    addBreadcrumb({
      category: 'nonce-allocator',
      message: 'Slot lock release via Lua failed — TTL will expire it',
      level: 'warning',
      data: { address, chain, error: String(error) },
    });
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
    // Fallback: all retries exhausted (800ms waited). Use RPC directly.
    // This is the pre-fix behaviour — possible collision — but better than hard failure.
    const rpcNonce = await getChainPendingNonce(address, chain);
    await captureMessage('Nonce allocator: slot lock exhausted — falling back to RPC nonce', {
      area: 'nonce-allocator',
      level: 'warning',
      context: { address, chain, rpcNonce },
      fingerprint: ['nonce-allocator', 'lock-exhausted'],
    });
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

    // Step 5: Persist the counter
    await redis.set(counterKey, String(nextNonce));

    // Step 6: Mark nonce as inflight (score = allocation epoch ms for gap detection)
    const epochMs = Date.now();
    await redis.zadd(inflightKey, {
      score: epochMs,
      member: String(nextNonce),
    });

    addBreadcrumb({
      category: 'nonce-allocator',
      message: 'Nonce allocated',
      level: 'info',
      data: {
        address,
        chain,
        nextNonce,
        chainPendingNonce,
        redisCounter,
        source: 'allocator',
      },
    });

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
 * GAP_THRESHOLD_MS and trigger a Sentry alert.
 */
export async function releaseInflightNonce(
  address: string,
  chain: string,
  nonce: number,
): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.zrem(NONCE_KEYS.inflight(address, chain), String(nonce));
    addBreadcrumb({
      category: 'nonce-allocator',
      message: 'Inflight nonce released',
      level: 'info',
      data: { address, chain, nonce },
    });
  } catch (error) {
    // Non-fatal. The nonce will be treated as a gap candidate and investigated.
    // Do not rethrow — the transaction has already been broadcast.
    await captureException(error, {
      area: 'nonce-allocator',
      context: { address, chain, nonce },
      fingerprint: ['nonce-allocator', 'release-failed'],
    });
  }
}

/**
 * Scan the inflight set for nonces older than GAP_THRESHOLD_MS.
 *
 * For each candidate:
 *   1. Verify the nonce is genuinely missing from the chain/mempool.
 *   2. If confirmed (chain moved past it) — stale entry, clean up.
 *   3. If genuinely missing — record in Sentry so the dead-task recovery job
 *      (which already detects tasks stuck in 'running' with no txHash > 10 min)
 *      can re-sign and rebroadcast using DB-stored task parameters.
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
    const staleMembers = await redis.zrangebyscore(inflightKey, 0, gapThreshold);

    if (staleMembers.length === 0) return;

    const staleNonces = staleMembers.map(Number);

    addBreadcrumb({
      category: 'nonce-allocator',
      message: 'Stale inflight nonces detected',
      level: 'warning',
      data: { address, chain, staleNonces },
    });

    // For each stale nonce, verify against chain state
    for (const staleNonce of staleNonces) {
      await investigateStaleNonce(address, chain, staleNonce);
    }
  } catch (error) {
    // Scan failure is non-fatal. Gap detection will retry on next broadcast.
    await captureException(error, {
      area: 'nonce-allocator',
      context: { address, chain },
      fingerprint: ['nonce-allocator', 'scan-failed'],
    });
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
      addBreadcrumb({
        category: 'nonce-allocator',
        message: 'Stale inflight entry removed (nonce already past chain pending)',
        level: 'info',
        data: { address, chain, nonce, chainPending },
      });
      return;
    }

    // Nonce is genuinely missing from mempool.
    // Record for investigation. The dead-task recovery job
    // (SELECT FROM mint_tasks WHERE status='running' AND tx_hash IS NULL AND
    //  updated_at < NOW() - INTERVAL '10 minutes')
    // will find the stuck task, re-sign, and rebroadcast.
    await captureMessage('Nonce gap confirmed — wallet may be stuck', {
      area: 'nonce-allocator',
      level: 'error',
      context: {
        address,
        chain,
        gapNonce: nonce,
        chainPending,
        recoveryHint:
          'Query mint_tasks WHERE status=running AND tx_hash IS NULL, re-sign with this nonce.',
      },
      fingerprint: ['nonce-allocator', 'gap-confirmed', address, chain],
    });
  } catch (error) {
    await captureException(error, {
      area: 'nonce-allocator',
      context: { address, chain, nonce },
      fingerprint: ['nonce-allocator', 'investigate-failed'],
    });
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

  // Seed counter to (pending - 1) so that next INCR-equivalent produces pending
  await redis.set(NONCE_KEYS.counter(address, chain), String(chainPendingNonce - 1));

  // Clear inflight set — all previous allocations are now invalid
  await redis.del(NONCE_KEYS.inflight(address, chain));

  addBreadcrumb({
    category: 'nonce-allocator',
    message: 'Nonce counter reset',
    level: 'warning',
    data: { address, chain, chainPendingNonce },
  });

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
    redis.zrangebyscore(NONCE_KEYS.inflight(address, chain), 0, '+inf'),
  ]);

  return {
    redisCounter: counterRaw !== null ? Number(counterRaw) : null,
    chainPending,
    inflightCount: inflightMembers.length,
    inflightNonces: inflightMembers.map(Number),
  };
}
