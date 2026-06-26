import 'server-only';

import { Redis } from '@upstash/redis';
import { addBreadcrumb } from '@/lib/observability/sentry';

let _redis: Redis | null = null;

function getRedisConfig() {
  return {
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  };
}

function getRedisClient(): Redis {
  if (!_redis) {
    const { url, token } = getRedisConfig();

    if (!url || !token) {
      throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN must be set');
    }
    _redis = new Redis({
      url,
      token,
    });
  }
  return _redis;
}

/**
 * Singleton Redis client. Initializes lazily.
 */
export const redis = new Proxy<Redis>({} as Redis, {
  get(_target, prop) {
    return getRedisClient()[prop as keyof Redis];
  },
});

export { getRedisClient };

// ─── Cache Keys ──────────────────────────────────────

export const CACHE_KEYS = {
  walletBalance: (address: string, chain: string) => `balance:${chain}:${address.toLowerCase()}`,
  collectionMetadata: (address: string, chain: string) => `collection:${chain}:${address.toLowerCase()}`,
  mintStatus: (address: string, chain: string) => `mint-status:${chain}:${address.toLowerCase()}`,
  dashboardStats: (userId: string) => `dashboard:${userId}`,
  floorPrice: (address: string, chain: string) => `floor:${chain}:${address.toLowerCase()}`,
  rateLimit: (identifier: string) => `ratelimit:${identifier}`,
  collectionStats: (address: string, chain: string) => `stats:${chain}:${address.toLowerCase()}`,
  owners: (address: string, chain: string, tokenId?: string) => `owners:${chain}:${address.toLowerCase()}:${tokenId || 'latest'}`,
} as const;

export const CACHE_TTL = {
  walletBalance: 300,       // 5 minutes
  collectionMetadata: 3600, // 1 hour
  mintStatus: 30,           // 30 seconds
  dashboardStats: 300,      // 5 minutes
  floorPrice: 600,          // 10 minutes
  rateLimit: 60,            // 1 minute
  collectionStats: 900,     // 15 minutes
  owners: 1800,             // 30 minutes
} as const;

// ─── Cache Utilities ────────────────────────────────

/**
 * Get a cached value. Returns null on miss or error.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient();
    const raw = await client.get(key);
    if (raw === null || raw === undefined) return null;
    return raw as T;
  } catch (error) {
    addBreadcrumb({ category: 'redis', message: `GET error for key "${key}"`, level: 'error', data: { key, error: String(error) } });
    return null;
  }
}

/**
 * Set a cached value with TTL (seconds).
 */
export async function setCache<T>(key: string, value: T, ttl: number): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.set(key, value, { ex: ttl });
    return true;
  } catch (error) {
    addBreadcrumb({ category: 'redis', message: `SET error for key "${key}"`, level: 'error', data: { key, error: String(error) } });
    return false;
  }
}

/**
 * Delete a cached key.
 */
export async function invalidateCache(key: string): Promise<boolean> {
  try {
    const client = getRedisClient();
    await client.del(key);
    return true;
  } catch (error) {
    addBreadcrumb({ category: 'redis', message: `DEL error for key "${key}"`, level: 'error', data: { key, error: String(error) } });
    return false;
  }
}

/**
 * Get or set cache with a TTL. If miss, calls the fetch function to hydrate.
 *
 * M-6 fix: add a per-key mutex to prevent cache stampedes.
 * Without this, N concurrent cold-cache misses all call fetchFn() simultaneously,
 * fanning out to N upstream RPC/API calls at once. During a mint window this
 * causes a burst of getWalletBalance / getMintState / collection calls.
 *
 * Fix: the first caller acquires a short-lived Redis lock (SET NX) before
 * fetching. Subsequent callers wait briefly then re-read from cache.
 * If the lock is unavailable (Redis hiccup) we fall through and fetch anyway
 * rather than blocking — fail-open is safer than fail-closed for reads.
 */
export async function cacheWithTTL<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number,
): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached !== null) return cached;

  const client = getRedisClient();
  const lockKey = `stampede-lock:${key}`;
  const lockToken = Math.random().toString(36).slice(2);

  let lockAcquired = false;
  try {
    const result = await client.set(lockKey, lockToken, { nx: true, ex: Math.min(ttl, 10) });
    lockAcquired = result !== null && result !== undefined;
  } catch {
    // Redis error acquiring lock — fall through and fetch directly (fail-open)
  }

  if (!lockAcquired) {
    // Another worker is already fetching — wait 120ms then read from cache.
    // If still empty (fetch hasn't finished) fall through and fetch ourselves.
    await new Promise(r => setTimeout(r, 120));
    const retried = await getCache<T>(key);
    if (retried !== null) return retried;
  }

  try {
    const fresh = await fetchFn();
    await setCache(key, fresh, ttl);
    return fresh;
  } finally {
    if (lockAcquired) {
      // Release lock only if we still own it (atomic Lua CAS)
      const lua = `if redis.call("GET",KEYS[1])==ARGV[1] then return redis.call("DEL",KEYS[1]) else return 0 end`;
      await client.eval(lua, [lockKey], [lockToken]).catch(() => undefined);
    }
  }
}

/**
 * Check if a key exists.
 */
export async function hasCache(key: string): Promise<boolean> {
  try {
    const client = getRedisClient();
    const exists = await client.exists(key);
    return exists === 1;
  } catch (error) {
    addBreadcrumb({ category: 'redis', message: `EXISTS error for key "${key}"`, level: 'error', data: { key, error: String(error) } });
    return false;
  }
}


// ─── Health Check ────────────────────────────────────

export interface RedisHealth {
  status: 'healthy' | 'unhealthy';
  ping: number;
  error: string | null;
  envConfigured: boolean;
}

export async function checkRedisHealth(): Promise<RedisHealth> {
  const { url, token } = getRedisConfig();
  const envConfigured = !!(url && token);
  if (!envConfigured) {
    return { status: 'unhealthy', ping: 0, error: 'Redis env vars not configured', envConfigured: false };
  }

  const start = Date.now();
  try {
    const client = getRedisClient();
    const ping = await client.ping();
    const latency = Date.now() - start;
    return {
      status: ping === 'PONG' ? 'healthy' : 'unhealthy',
      ping: latency,
      error: ping !== 'PONG' ? 'Unexpected ping response' : null,
      envConfigured,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      ping: Date.now() - start,
      error: error instanceof Error ? error.message : 'Unknown Redis error',
      envConfigured,
    };
  }
}
