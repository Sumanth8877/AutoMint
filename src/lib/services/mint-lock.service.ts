import 'server-only';

import crypto from 'crypto';
import { getRedisClient } from '@/lib/redis';
import { addBreadcrumb, captureException, captureMessage } from '@/lib/observability/sentry';

const LOCK_TTL_SECONDS = 5 * 60;

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

export async function acquireLock(mintId: string, ttlSeconds = LOCK_TTL_SECONDS): Promise<MintLock> {
  const key = lockKey(mintId);
  const token = createToken();

  try {
    const result = await getRedisClient().set(key, token, {
      ex: ttlSeconds,
      nx: true,
    });

    if (result === null || result === undefined) {
      addBreadcrumb({ category: 'mint-lock', message: 'Lock already exists — deduplicate', level: 'warning', data: { mintId, key } });
      addBreadcrumb({ category: 'mint-lock', message: 'Lock exists', level: 'info', data: { mintId, key } });
      await captureMessage('Mint lock exists', {
        area: 'mint-lock',
        level: 'warning',
        context: { taskId: mintId },
        fingerprint: ['mint-lock', 'exists'],
      });
      return { acquired: false, mintId, key };
    }

    console.log('[MintLock] Lock acquired', { mintId, key });
    addBreadcrumb({ category: 'mint-lock', message: 'Lock acquired', level: 'info', data: { mintId, key } });
    return { acquired: true, mintId, key, token };
  } catch (error) {
    await captureException(error, {
      area: 'mint-lock',
      context: { taskId: mintId, key },
      fingerprint: ['mint-lock', 'acquire'],
    });
    throw error;
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
        addBreadcrumb({ category: 'mint-lock', message: 'Release skipped — token mismatch or lock already expired', level: 'warning', data: { mintId, key } });
        return false;
      }
    } else {
      await getRedisClient().del(key);
    }

    console.log('[MintLock] Lock released', { mintId, key });
    addBreadcrumb({ category: 'mint-lock', message: 'Lock released', level: 'info', data: { mintId, key } });
    return true;
  } catch (error) {
    await captureException(error, {
      area: 'mint-lock',
      context: { taskId: mintId, key },
      fingerprint: ['mint-lock', 'release'],
    });
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
      addBreadcrumb({ category: 'mint-lock', message: 'Extend skipped — token mismatch or lock already expired', level: 'warning', data: { mintId, key } });
      return false;
    }

    console.log('[MintLock] Lock extended', { mintId, key, ttlSeconds });
    addBreadcrumb({ category: 'mint-lock', message: 'Lock extended', level: 'info', data: { mintId, key, ttlSeconds } });
    return true;
  } catch (error) {
    await captureException(error, {
      area: 'mint-lock',
      context: { taskId: mintId, key },
      fingerprint: ['mint-lock', 'extend'],
    });
    throw error;
  }
}
