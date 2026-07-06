import { getRedisClient } from './index';
import crypto from 'crypto';

const DEFAULT_LOCK_TTL = 60; // seconds
const LOCK_PREFIX = 'cron:lock:';

/**
 * Acquire a distributed lock via Upstash Redis SET NX EX.
 *
 * Prevents concurrent cron executions from processing the same tasks.
 * Lock automatically expires after `ttl` seconds (crash recovery).
 *
 * @returns A unique lock token string if acquired, or null if the lock is already held.
 *          Pass the token to releaseCronLock() to safely release only your lock.
 */
export async function acquireCronLock(
  lockName: string,
  ttl = DEFAULT_LOCK_TTL,
): Promise<string | null> {
  try {
    const client = getRedisClient();
    const key = `${LOCK_PREFIX}${lockName}`;
    // Store a unique token (not a static value) so releaseCronLock can use
    // atomic CAS to avoid deleting another process's lock.
    const token = crypto.randomBytes(16).toString('hex');
    const result = await client.set(key, token, {
      ex: ttl,
      nx: true,
    });
    if (result !== null && result !== undefined) {
      return token;
    }
    return null;
  } catch (_error) {
    return null; // Fail open — allow execution rather than blocking
  }
}

/**
 * Release a distributed lock using atomic Lua CAS.
 *
 * Performs GET + DEL in a single Redis round-trip to prevent TOCTOU race:
 * without this, a crashed process could DEL a lock acquired by a new holder
 * after the original TTL expired.
 *
 * Best-effort; lock will expire on its own via TTL if this call fails.
 *
 * @param token - The token returned by acquireCronLock(). Required for safe release.
 */
export async function releaseCronLock(lockName: string, token: string): Promise<void> {
  try {
    const client = getRedisClient();
    const key = `${LOCK_PREFIX}${lockName}`;
    // Atomic Lua CAS: only DEL if the stored value matches our token.
    // Prevents deleting a lock acquired by a new process after ours expired/crashed.
    const luaRelease = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    const deleted = await client.eval(luaRelease, [key], [token]) as number;
    if (deleted === 0) {
    }
  } catch (_error) {
    // Non-fatal — TTL expiry handles crash recovery
  }
}
