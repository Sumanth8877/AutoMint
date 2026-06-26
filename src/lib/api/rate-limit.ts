import 'server-only';

import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';
import { addBreadcrumb } from '@/lib/observability/sentry';

export type RateLimitOptions = {
  /** Maximum number of requests allowed within the window. */
  limit: number;
  /** Length of the fixed window, in seconds. */
  windowSeconds: number;
};

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds when the current window resets. */
  reset: number;
};

const RATE_LIMIT_PREFIX = 'ratelimit:';

/**
 * Fixed-window rate limiter backed by Upstash Redis (INCR + EXPIRE).
 *
 * The first request in a window sets the key and its TTL; subsequent requests
 * increment the counter. Once the counter exceeds `limit`, requests are denied
 * until the key expires.
 *
 * Fails OPEN: if Redis is unreachable we allow the request rather than taking
 * the whole API down (matches the behaviour of acquireCronLock).
 */
export async function checkRateLimit(
  identifier: string,
  { limit, windowSeconds }: RateLimitOptions,
): Promise<RateLimitResult> {
  try {
    const client = getRedisClient();
    const key = `${RATE_LIMIT_PREFIX}${identifier}`;

    // M-7 fix: use an atomic Lua script for INCR + EXPIRE.
    // The old code did INCR then EXPIRE as two separate commands. If the process
    // crashed between them the key would persist forever with no TTL, allowing
    // the next request to bypass the rate limit entirely.
    // This Lua script runs atomically: INCR and conditional EXPIRE in one op.
    const luaRateLimit = `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then
        redis.call('EXPIRE', KEYS[1], ARGV[1])
      end
      return count
    `;
    const count = await client.eval(luaRateLimit, [key], [String(windowSeconds)]) as number;

    let ttl = await client.ttl(key);
    // Defensive: if TTL is somehow missing (pre-existing key with no TTL), set it.
    if (ttl < 0) {
      await client.expire(key, windowSeconds);
      ttl = windowSeconds;
    }

    return {
      success: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      reset: Date.now() + ttl * 1000,
    };
  } catch (error) {
    addBreadcrumb({ category: 'rate-limit', message: `Rate limit check error for "${identifier}"`, level: 'error', data: { identifier, error: String(error) } });
    // Fail open — never block traffic because the limiter is unavailable.
    return {
      success: true,
      limit,
      remaining: limit,
      reset: Date.now() + windowSeconds * 1000,
    };
  }
}

/**
 * Enforce a rate limit for the given identifier.
 *
 * Usage in a route handler:
 *
 *   const limited = await enforceRateLimit(`wallets:import:${userId}`, {
 *     limit: 10,
 *     windowSeconds: 60,
 *   });
 *   if (limited) return limited;
 *
 * @returns a 429 NextResponse when the caller is over the limit, otherwise null.
 */
export async function enforceRateLimit(
  identifier: string,
  options: RateLimitOptions,
): Promise<NextResponse | null> {
  const result = await checkRateLimit(identifier, options);

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.reset / 1000)),
  };

  if (result.success) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { error: 'Too many requests. Please slow down and try again shortly.' },
    {
      status: 429,
      headers: { ...headers, 'Retry-After': String(retryAfterSeconds) },
    },
  );
}

/**
 * Common rate-limit presets keyed by endpoint sensitivity.
 * Only presets that are actively used are kept here — do not add speculative
 * ones that are not yet wired into a route handler.
 */
export const RATE_LIMITS = {
  /** Expensive endpoints that fan out to external APIs / RPCs (e.g. /api/analyzer). */
  expensive: { limit: 20, windowSeconds: 60 },
  /** Token / link generation endpoints (e.g. /api/telegram/link-token). */
  tokenGeneration: { limit: 5, windowSeconds: 60 },
} as const;
