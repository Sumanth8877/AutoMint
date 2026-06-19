import { getRedisClient } from './index';

const DEFAULT_LOCK_TTL = 60; // seconds
const LOCK_PREFIX = 'cron:lock:';

/**
 * Acquire a distributed lock via Upstash Redis SET NX EX.
 *
 * Prevents concurrent cron executions from processing the same tasks.
 * Lock automatically expires after `ttl` seconds (crash recovery).
 *
 * @returns true if lock acquired, false if already held
 */
export async function acquireCronLock(
  lockName: string,
  ttl = DEFAULT_LOCK_TTL,
): Promise<boolean> {
  try {
    const client = getRedisClient();
    const key = `${LOCK_PREFIX}${lockName}`;
    const result = await client.set(key, '1', {
      ex: ttl,
      nx: true,
    });
    return result !== null && result !== undefined;
  } catch (error) {
    console.error(`[Redis] Lock acquire error for "${lockName}":`, error);
    return false; // Fail open — allow execution rather than blocking
  }
}

/**
 * Release a distributed lock.
 * Best-effort; lock will expire on its own via TTL.
 */
export async function releaseCronLock(lockName: string): Promise<void> {
  try {
    const client = getRedisClient();
    const key = `${LOCK_PREFIX}${lockName}`;
    await client.del(key);
  } catch (error) {
    console.error(`[Redis] Lock release error for "${lockName}":`, error);
    // Non-fatal — TTL expiry handles crash recovery
  }
}