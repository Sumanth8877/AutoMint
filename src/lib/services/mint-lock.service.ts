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
      console.warn('[MintLock] Lock exists', { mintId, key });
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

// C-2 FIX: Atomic Lua compare-and-delete.
// OLD: redis.get -> compare -> redis.del  (3 commands, TOCTOU gap)
// NEW: single Lua script executed atomically on Redis -- zero race window
const RELEASE_LUA = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end
`;

// C-2 FIX: Atomic Lua compare-and-expire.
// OLD: redis.get -> compare -> redis.expire  (3 commands, TOCTOU gap)
// NEW: single Lua script, atomic
const EXTEND_LUA = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
  else
    return 0
  end
`;

export async function releaseLock(mintId: string, token?: string) {
  const key = lockKey(mintId);

  try {
    if (token) {
      const result = await getRedisClient().eval(RELEASE_LUA, [key], [token]);
      if (result === 0) {
        console.warn('[MintLock] Release skipped; token mismatch', { mintId, key });
        addBreadcrumb({ category: 'mint-lock', message: 'Release skipped: token mismatch', level: 'warning', data: { mintId, key } });
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
    const result = await getRedisClient().eval(EXTEND_LUA, [key], [token, String(ttlSeconds)]);
    if (result === 0) {
      console.warn('[MintLock] Extend skipped; token mismatch or missing lock', { mintId, key });
      addBreadcrumb({ category: 'mint-lock', message: 'Extend skipped: token mismatch', level: 'warning', data: { mintId, key } });
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
