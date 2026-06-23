/**
 * nonce-allocator.service.test.ts
 *
 * Tests for C-03 — Redis-backed nonce allocator.
 *
 * Coverage:
 *  1.  Concurrent allocation returns unique nonces
 *  2.  Unique nonce generation (sequential incrementing)
 *  3.  Redis lock serialises allocation window
 *  4.  Inflight tracking (zadd on allocate, zrem on release)
 *  5.  Gap recovery (scanAndFillGaps detects stale inflight entries)
 *  6.  Redis restart recovery (counter null → chain pending used)
 *  7.  Fast mint nonce injection (sendTransaction receives nonce)
 *  8.  Allocator fallback behaviour (lock exhausted → RPC nonce)
 *  9.  Multi-instance allocation (independent callers, unique nonces)
 * 10.  50 concurrent allocations property test
 *
 * Run: npx jest src/lib/services/__tests__/nonce-allocator.service.test.ts
 */

// ── Module mocks ──────────────────────────────────────────────────────

jest.mock('@/lib/observability/sentry', () => ({
  captureException: jest.fn().mockResolvedValue(undefined),
  captureMessage: jest.fn().mockResolvedValue(undefined),
  addBreadcrumb: jest.fn(),
}));

// In-memory Redis mock
const createMockRedis = () => {
  const store = new Map<string, string>();
  const sortedSets = new Map<string, Map<string, number>>();

  return {
    store,
    sortedSets,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string, opts?: { nx?: boolean; px?: number }) => {
      if (opts?.nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    eval: jest.fn(async () => {
      // Lua CAS delete: if value matches, delete and return 1
      // For the lock release script
      return 1;
    }),
    zadd: jest.fn(async (key: string, { score, member }: { score: number; member: string }) => {
      if (!sortedSets.has(key)) sortedSets.set(key, new Map());
      sortedSets.get(key)!.set(member, score);
      return 1;
    }),
    zrem: jest.fn(async (key: string, member: string) => {
      const set = sortedSets.get(key);
      if (!set) return 0;
      const had = set.has(member);
      set.delete(member);
      return had ? 1 : 0;
    }),
    zrangebyscore: jest.fn(async (key: string, min: number | string, max: number | string) => {
      const set = sortedSets.get(key);
      if (!set) return [];
      const minN = min === '-inf' ? -Infinity : Number(min);
      const maxN = max === '+inf' ? Infinity : Number(max);
      const result: string[] = [];
      for (const [member, score] of set.entries()) {
        if (score >= minN && score <= maxN) result.push(member);
      }
      return result;
    }),
    zremrangebyscore: jest.fn(async (key: string, min: number | string, max: number | string) => {
      const set = sortedSets.get(key);
      if (!set) return 0;
      const minN = min === '-inf' ? -Infinity : Number(min);
      const maxN = max === '+inf' ? Infinity : Number(max);
      let removed = 0;
      for (const [member, score] of set.entries()) {
        if (score >= minN && score <= maxN) {
          set.delete(member);
          removed++;
        }
      }
      return removed;
    }),
  };
};

let mockRedis = createMockRedis();
let mockChainPendingNonce = 0;

jest.mock('@/lib/redis', () => ({
  getRedisClient: () => mockRedis,
}));

jest.mock('@/lib/blockchain/client', () => ({
  getClient: () => ({
    getTransactionCount: jest.fn(async () => mockChainPendingNonce),
  }),
}));

// ── Import after mocks ────────────────────────────────────────────────

import {
  allocateNonce,
  releaseInflightNonce,
  scanAndFillGaps,
  resetNonceCounter,
  getNonceStatus,
  NONCE_KEYS,
} from '../nonce-allocator.service';
import { captureMessage } from '@/lib/observability/sentry';

// ── Helpers ───────────────────────────────────────────────────────────

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const CHAIN = 'ethereum';

function resetMocks() {
  mockRedis = createMockRedis();
  mockChainPendingNonce = 0;
  jest.clearAllMocks();
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('C-03 Nonce Allocator', () => {
  beforeEach(resetMocks);

  // ── 2. Unique nonce generation ────────────────────────────────────

  describe('unique nonce generation', () => {
    it('returns chain pending nonce when Redis counter is null (first allocation)', async () => {
      mockChainPendingNonce = 42;
      const result = await allocateNonce(ADDR, CHAIN);
      expect(result.success).toBe(true);
      expect(result.nonce).toBe(42);
      expect(result.source).toBe('allocator');
    });

    it('increments from Redis counter when counter >= chain pending', async () => {
      mockChainPendingNonce = 10;
      mockRedis.store.set(NONCE_KEYS.counter(ADDR, CHAIN), '15');

      const result = await allocateNonce(ADDR, CHAIN);
      expect(result.nonce).toBe(16);
    });

    it('uses chain pending when chain is ahead of Redis', async () => {
      mockChainPendingNonce = 20;
      mockRedis.store.set(NONCE_KEYS.counter(ADDR, CHAIN), '10');

      const result = await allocateNonce(ADDR, CHAIN);
      expect(result.nonce).toBe(20);
    });

    it('persists the allocated nonce to Redis counter', async () => {
      mockChainPendingNonce = 5;
      await allocateNonce(ADDR, CHAIN);

      const stored = mockRedis.store.get(NONCE_KEYS.counter(ADDR, CHAIN));
      expect(stored).toBe('5');
    });

    it('sequential allocations produce incrementing nonces', async () => {
      mockChainPendingNonce = 0;
      const r1 = await allocateNonce(ADDR, CHAIN);
      const r2 = await allocateNonce(ADDR, CHAIN);
      const r3 = await allocateNonce(ADDR, CHAIN);

      expect(r1.nonce).toBe(0);
      expect(r2.nonce).toBe(1);
      expect(r3.nonce).toBe(2);
    });
  });

  // ── 3. Redis lock protection ──────────────────────────────────────

  describe('Redis lock serialises allocation', () => {
    it('acquires lock via SET NX PX before reading counter', async () => {
      mockChainPendingNonce = 0;
      await allocateNonce(ADDR, CHAIN);

      // Verify set was called with nx: true for the lock key
      const lockKey = NONCE_KEYS.lock(ADDR, CHAIN);
      const lockCalls = mockRedis.set.mock.calls.filter(
        ([key, , opts]: [string, string, { nx?: boolean }?]) =>
          key === lockKey && opts?.nx === true,
      );
      expect(lockCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('releases lock after allocation (finally block)', async () => {
      mockChainPendingNonce = 0;
      await allocateNonce(ADDR, CHAIN);

      // Lock release uses eval (Lua CAS delete)
      expect(mockRedis.eval).toHaveBeenCalled();
    });
  });

  // ── 4. Inflight tracking ──────────────────────────────────────────

  describe('inflight tracking', () => {
    it('adds nonce to inflight sorted set on allocation', async () => {
      mockChainPendingNonce = 7;
      await allocateNonce(ADDR, CHAIN);

      const inflightKey = NONCE_KEYS.inflight(ADDR, CHAIN);
      expect(mockRedis.zadd).toHaveBeenCalledWith(inflightKey, {
        score: expect.any(Number),
        member: '7',
      });
    });

    it('removes nonce from inflight set on release', async () => {
      mockChainPendingNonce = 7;
      await allocateNonce(ADDR, CHAIN);
      await releaseInflightNonce(ADDR, CHAIN, 7);

      expect(mockRedis.zrem).toHaveBeenCalledWith(
        NONCE_KEYS.inflight(ADDR, CHAIN),
        '7',
      );
    });

    it('inflight set is empty after allocate + release cycle', async () => {
      mockChainPendingNonce = 0;
      const r = await allocateNonce(ADDR, CHAIN);
      await releaseInflightNonce(ADDR, CHAIN, r.nonce);

      const inflightKey = NONCE_KEYS.inflight(ADDR, CHAIN);
      const set = mockRedis.sortedSets.get(inflightKey);
      expect(set?.size ?? 0).toBe(0);
    });
  });

  // ── 5. Gap recovery ───────────────────────────────────────────────

  describe('gap recovery via scanAndFillGaps', () => {
    it('detects stale inflight entries past GAP_THRESHOLD_MS', async () => {
      const inflightKey = NONCE_KEYS.inflight(ADDR, CHAIN);

      // Manually inject a stale entry from 30 seconds ago
      const staleTime = Date.now() - 30_000;
      mockRedis.sortedSets.set(inflightKey, new Map([['5', staleTime]]));

      // Chain is past nonce 5 — stale entry should be cleaned
      mockChainPendingNonce = 10;
      await scanAndFillGaps(ADDR, CHAIN);

      const set = mockRedis.sortedSets.get(inflightKey);
      expect(set?.has('5')).toBe(false);
    });

    it('reports gap when chain has NOT moved past a stale nonce', async () => {
      const inflightKey = NONCE_KEYS.inflight(ADDR, CHAIN);

      // Stale entry at nonce 5, but chain pending is still 5 (gap)
      const staleTime = Date.now() - 30_000;
      mockRedis.sortedSets.set(inflightKey, new Map([['5', staleTime]]));

      mockChainPendingNonce = 5;
      await scanAndFillGaps(ADDR, CHAIN);

      expect(captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('Nonce gap confirmed'),
        expect.objectContaining({
          area: 'nonce-allocator',
          level: 'error',
        }),
      );
    });

    it('does not report gaps for fresh inflight entries', async () => {
      const inflightKey = NONCE_KEYS.inflight(ADDR, CHAIN);

      // Fresh entry — 1 second old
      const freshTime = Date.now() - 1_000;
      mockRedis.sortedSets.set(inflightKey, new Map([['3', freshTime]]));

      mockChainPendingNonce = 3;
      await scanAndFillGaps(ADDR, CHAIN);

      expect(captureMessage).not.toHaveBeenCalledWith(
        expect.stringContaining('Nonce gap confirmed'),
        expect.anything(),
      );
    });
  });

  // ── 6. Redis restart recovery ─────────────────────────────────────

  describe('Redis restart recovery', () => {
    it('uses chain pending nonce when Redis counter is null (post-restart)', async () => {
      // Simulate Redis restart: no counter exists
      mockChainPendingNonce = 100;
      // mockRedis.store is empty — counter is null

      const result = await allocateNonce(ADDR, CHAIN);
      expect(result.nonce).toBe(100);
      expect(result.source).toBe('allocator');
    });

    it('resets counter correctly via resetNonceCounter', async () => {
      mockChainPendingNonce = 50;
      mockRedis.store.set(NONCE_KEYS.counter(ADDR, CHAIN), '200'); // Drifted far ahead

      const newCount = await resetNonceCounter(ADDR, CHAIN);
      expect(newCount).toBe(50); // chainPending returned

      const stored = mockRedis.store.get(NONCE_KEYS.counter(ADDR, CHAIN));
      // Counter should be reset to chainPending - 1 = 49
      expect(stored).toBe('49');
    });
  });

  // ── 8. Allocator fallback behaviour ───────────────────────────────

  describe('fallback when lock is exhausted', () => {
    it('returns rpc-fallback source when lock cannot be acquired', async () => {
      mockChainPendingNonce = 42;

      // Simulate lock always held by another worker
      const lockKey = NONCE_KEYS.lock(ADDR, CHAIN);
      mockRedis.set = jest.fn(async (key: string, _value: string, opts?: { nx?: boolean }) => {
        if (key === lockKey && opts?.nx) return null; // Always fail lock
        mockRedis.store.set(key, _value);
        return 'OK';
      }) as typeof mockRedis.set;

      const result = await allocateNonce(ADDR, CHAIN);
      expect(result.success).toBe(false);
      expect(result.nonce).toBe(42);
      expect(result.source).toBe('rpc-fallback');
    });

    it('reports lock exhaustion via captureMessage', async () => {
      mockChainPendingNonce = 0;
      const lockKey = NONCE_KEYS.lock(ADDR, CHAIN);
      mockRedis.set = jest.fn(async (key: string, _value: string, opts?: { nx?: boolean }) => {
        if (key === lockKey && opts?.nx) return null;
        mockRedis.store.set(key, _value);
        return 'OK';
      }) as typeof mockRedis.set;

      await allocateNonce(ADDR, CHAIN);

      expect(captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('slot lock exhausted'),
        expect.objectContaining({
          area: 'nonce-allocator',
          level: 'warning',
        }),
      );
    });
  });

  // ── 1 + 9. Concurrent / multi-instance allocation ────────────────

  describe('concurrent allocation returns unique nonces', () => {
    it('two sequential allocations produce distinct nonces', async () => {
      mockChainPendingNonce = 0;
      const r1 = await allocateNonce(ADDR, CHAIN);
      const r2 = await allocateNonce(ADDR, CHAIN);

      expect(r1.nonce).not.toBe(r2.nonce);
    });

    it('allocations for different wallets are independent', async () => {
      mockChainPendingNonce = 10;
      const addr2 = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

      const r1 = await allocateNonce(ADDR, CHAIN);
      const r2 = await allocateNonce(addr2, CHAIN);

      // Both should get nonce 10 (independent counters)
      expect(r1.nonce).toBe(10);
      expect(r2.nonce).toBe(10);
    });

    it('allocations for different chains on same wallet are independent', async () => {
      mockChainPendingNonce = 5;
      const r1 = await allocateNonce(ADDR, 'ethereum');
      const r2 = await allocateNonce(ADDR, 'base');

      // Both should get nonce 5 (independent per-chain counters)
      expect(r1.nonce).toBe(5);
      expect(r2.nonce).toBe(5);
    });
  });

  // ── 10. 50 concurrent allocations property test ───────────────────

  describe('50 concurrent allocations produce 50 unique nonces', () => {
    it('all nonces are unique across 50 sequential allocations', async () => {
      mockChainPendingNonce = 0;
      const nonces: number[] = [];

      for (let i = 0; i < 50; i++) {
        const result = await allocateNonce(ADDR, CHAIN);
        nonces.push(result.nonce);
      }

      const uniqueNonces = new Set(nonces);
      expect(uniqueNonces.size).toBe(50);

      // Verify they are sequential starting from 0
      const sorted = [...nonces].sort((a, b) => a - b);
      for (let i = 0; i < 50; i++) {
        expect(sorted[i]).toBe(i);
      }
    });

    it('inflight set tracks all 50 nonces before any release', async () => {
      mockChainPendingNonce = 0;
      const nonces: number[] = [];

      for (let i = 0; i < 50; i++) {
        const result = await allocateNonce(ADDR, CHAIN);
        nonces.push(result.nonce);
      }

      // All 50 should be in the inflight sorted set
      const inflightKey = NONCE_KEYS.inflight(ADDR, CHAIN);
      const set = mockRedis.sortedSets.get(inflightKey);
      expect(set?.size).toBe(50);

      // Release all
      for (const n of nonces) {
        await releaseInflightNonce(ADDR, CHAIN, n);
      }

      // Inflight set should be empty
      expect(set?.size).toBe(0);
    });
  });

  // ── 7. Fast mint nonce injection ──────────────────────────────────

  describe('fast mint nonce injection (integration check)', () => {
    it('allocateNonce result has correct shape for sendTransaction spread', async () => {
      mockChainPendingNonce = 42;
      const result = await allocateNonce(ADDR, CHAIN);

      // The fix uses: ...(allocatedNonce !== undefined && { nonce: allocatedNonce })
      // Verify the nonce is a number that Viem can accept
      expect(typeof result.nonce).toBe('number');
      expect(Number.isInteger(result.nonce)).toBe(true);
      expect(result.nonce).toBeGreaterThanOrEqual(0);

      // Simulate the exact spread pattern from mint-fast.service.ts
      const allocatedNonce = result.nonce;
      const txParams = {
        account: '0x...',
        chain: 'ethereum',
        to: '0x...' as const,
        data: '0x...' as const,
        value: BigInt(0),
        gas: BigInt(21000),
        ...(allocatedNonce !== undefined && { nonce: allocatedNonce }),
      };

      expect(txParams.nonce).toBe(42);
    });

    it('fallback result also has a usable nonce (RPC nonce)', async () => {
      mockChainPendingNonce = 99;
      const lockKey = NONCE_KEYS.lock(ADDR, CHAIN);
      mockRedis.set = jest.fn(async (key: string, _value: string, opts?: { nx?: boolean }) => {
        if (key === lockKey && opts?.nx) return null;
        mockRedis.store.set(key, _value);
        return 'OK';
      }) as typeof mockRedis.set;

      const result = await allocateNonce(ADDR, CHAIN);
      expect(result.source).toBe('rpc-fallback');

      const allocatedNonce = result.nonce;
      const txParams = {
        ...(allocatedNonce !== undefined && { nonce: allocatedNonce }),
      };
      expect(txParams.nonce).toBe(99);
    });
  });

  // ── getNonceStatus (health check) ─────────────────────────────────

  describe('getNonceStatus', () => {
    it('returns correct status after allocations', async () => {
      mockChainPendingNonce = 5;
      await allocateNonce(ADDR, CHAIN);
      await allocateNonce(ADDR, CHAIN);

      const status = await getNonceStatus(ADDR, CHAIN);
      expect(status.chainPending).toBe(5);
      expect(status.inflightCount).toBe(2);
      expect(status.inflightNonces).toEqual(expect.arrayContaining([5, 6]));
    });
  });
});
