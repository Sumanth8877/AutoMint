import 'server-only';

import { Redis } from '@upstash/redis';

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
    console.error(`[Redis] GET error for key "${key}":`, error);
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
    console.error(`[Redis] SET error for key "${key}":`, error);
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
    console.error(`[Redis] DEL error for key "${key}":`, error);
    return false;
  }
}

/**
 * Get or set cache with a TTL. If miss, calls the fetch function to hydrate.
 */
export async function cacheWithTTL<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttl: number,
): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached !== null) return cached;

  const fresh = await fetchFn();
  await setCache(key, fresh, ttl);
  return fresh;
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
    console.error(`[Redis] EXISTS error for key "${key}":`, error);
    return false;
  }
}

// ─── Rate Limiting ──────────────────────────────────

/**
 * Simple sliding-window rate limit using Redis.
 * Returns true if allowed, false if rate-limited.
 */
export async function checkRateLimit(
  identifier: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<boolean> {
  const key = CACHE_KEYS.rateLimit(identifier);
  try {
    const client = getRedisClient();
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, windowSeconds);
    }
    return current <= maxRequests;
  } catch (error) {
    console.error(`[Redis] Rate limit error for "${identifier}":`, error);
    return true; // Allow on error (fail open)
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
