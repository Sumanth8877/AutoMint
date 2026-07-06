import 'server-only';

import crypto from 'crypto';
import { getRedisClient } from '@/lib/redis';

// Mint lock TTL. Tightened from 5 min → 60s because Vercel maxDuration is
// 10s for the qstash route, so a single execute attempt cannot run longer
// than that. 60s leaves 6× headroom while ensuring a crashed worker's lock
// expires quickly enough for the 90s stuck-task recovery threshold to
// safely re-fire the task. extendLock is defined but never called — the
// lock simply auto-expires.
const LOCK_TTL_SECONDS = 60;

export type MintLock = {
  acquired: boolean;
  mintId: string;
  key: string;
  token?: string;
};

function lockKey(mintId: string) {
  return `mint-lock:${mintId}`;
}

function createToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Acquire the mint lock for `mintId`.
 *
 * H1 fix: returns the unique lock TOKEN on success (or null on failure), instead
 * of a boolean. The token MUST be passed to releaseLock()/extendLock() so they
 * use the atomic Lua check-and-delete (CAS) path. Previously acquireLock returned
 * only a boolean, so every caller released without a token and silently fell back
 * to a plain DEL — which could delete a lock re-acquired by another worker after
 * the TTL expired, re-opening the duplicate-execution window.
 *
 * @returns the lock token string if acquired, or null if already held / on error.
 */
export async function acquireLock(mintId: string, ttlSeconds = LOCK_TTL_SECONDS): Promise<string | null> {
  const key = lockKey(mintId);
  const token = createToken();

  try {
    const result = await getRedisClient().set(key, token, {
      ex: ttlSeconds,
      nx: true,
    });

    if (result === null || result === undefined) {
      return null;
    }

    return token;
  } catch (error) {
    return null;
  }
}

export async function releaseLock(mintId: string, token?: string) {
  const key = lockKey(mintId);

  try {
    if (token) {
      // C-5 FIX: Atomic Lua CAS — GET + DEL in a single Redis round-trip.
      // Prevents TOCTOU: without this, a concurrent process could acquire the
      // lock between our GET check and our DEL call, and we would delete
      // their lock instead of ours.
      const luaRelease = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      const deleted = await getRedisClient().eval(luaRelease, [key], [token]) as number;
      if (deleted === 0) {
        return false;
      }
    } else {
      // No token — fall back to plain DEL (best-effort release).
      await getRedisClient().del(key);
    }

    return true;
  } catch (error) {
    return false;
  }
}

export async function extendLock(mintId: string, token: string, ttlSeconds = LOCK_TTL_SECONDS) {
  const key = lockKey(mintId);

  try {
    // C-5 FIX: Atomic Lua CAS — GET + EXPIRE in a single Redis round-trip.
    // Prevents TOCTOU: without this, another process could acquire the lock
    // between our GET check and our EXPIRE call, extending their lock instead.
    const luaExtend = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("EXPIRE", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    const extended = await getRedisClient().eval(luaExtend, [key], [token, String(ttlSeconds)]) as number;

    if (extended === 0) {
      return false;
    }

    return true;
  } catch (error) {
    throw error;
  }
}
