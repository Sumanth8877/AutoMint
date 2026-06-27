/**
 * src/lib/services/__tests__/copy-mint.service.test.ts
 *
 * Integration tests for the copy-mint execution flow.
 *
 * Flow under test:
 *   Alchemy webhook → handleCopyMintEvent()
 *     → loadCopyMintRules()      (find matching rules for watched wallet)
 *     → loadDefaultMintWallet()  (resolve destination wallet)
 *     → price/risk gate          (check maxPrice and riskThreshold)
 *     → executeMintTask()        (trigger on-chain mint)
 *
 * These tests use mocks for external dependencies (DB, executeMintTask, Telegram)
 * and verify the routing logic, guard conditions, and error paths.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';

// ─── Mock external dependencies ───────────────────────────────────
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/lib/services/mint.service', () => ({
  executeMintTask: vi.fn(),
}));

vi.mock('@/lib/services/mint-lock.service', () => ({
  acquireLock: vi.fn().mockResolvedValue({ acquired: true, mintId: 'test-lock', key: 'mint-lock:test', token: 'tok' }),
  releaseLock: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/services/telegram.service', () => ({
  sendTelegramNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/observability/sentry', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/monitoring', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/mint-requirements.service', () => ({
  fetchMintRequirements: vi.fn().mockResolvedValue({ mintPrice: '0.05', isSoldOut: false }),
}));

vi.mock('@/lib/services/mint-state.service', () => ({
  getMintState: vi.fn().mockResolvedValue({ status: 'ACTIVE', isMintable: true }),
}));

import { handleCopyMintEvent } from '../copy-mint.service';
import { getDb } from '@/lib/db';
import { executeMintTask } from '@/lib/services/mint.service';

// ─── Test fixtures ─────────────────────────────────────────────────
const mockCopyMintEvent = {
  userId: 'user-123',
  watchedWalletAddress: '0xwhale0000000000000000000000000000000000',
  chain: 'ethereum' as const,
  contractAddress: '0xcontract000000000000000000000000000000',
  transactionHash: '0xtxhash',
};

const mockWallet = {
  id: 'wallet-1',
  userId: 'user-123',
  address: '0xmywallet000000000000000000000000000000',
  walletType: 'EVM',
  chain: 'ethereum',
  encryptedPrivateKey: 'v1:encrypted',
  isDefault: true,
  createdAt: new Date(),
};

const mockRule = {
  id: 'rule-1',
  userId: 'user-123',
  walletAddress: '0xwhale0000000000000000000000000000000000',
  enabled: true,
  autoMint: true,
  maxPrice: '0.1',
  quantity: 1,
  riskThreshold: 75,
  destinationWalletId: null,
  createdAt: new Date(),
};

const mockMintTask = {
  id: 'task-1',
  userId: 'user-123',
  walletId: 'wallet-1',
  collectionId: 'col-1',
  status: 'pending',
  quantity: 1,
};

function buildDbMock(rules: unknown[], wallet: unknown, task: unknown) {
  const mockSelect = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };

  let callCount = 0;
  const responses = [rules, [wallet], [task]];
  mockSelect.limit.mockImplementation(() => ({
    then: (resolve: (v: unknown) => unknown) => {
      const response = responses[callCount] ?? [];
      callCount++;
      return Promise.resolve(resolve(response));
    },
    [Symbol.iterator]: function* () { yield* (responses[callCount - 1] ?? []); },
  }));

  return {
    select: vi.fn(() => mockSelect),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([task]) })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([task]) })) })) })),
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('handleCopyMintEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes mint when a matching enabled rule exists and price is within limit', async () => {
    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([mockRule], mockWallet, mockMintTask)
    );
    (executeMintTask as MockedFunction<typeof executeMintTask>).mockResolvedValue({
      status: 'completed',
      txHash: '0xabc',
    } as ReturnType<typeof executeMintTask> extends Promise<infer T> ? T : never);

    const result = await handleCopyMintEvent(mockCopyMintEvent);
    expect(result.status).toBe('completed');
    expect(executeMintTask).toHaveBeenCalledTimes(1);
  });

  it('skips mint when no matching rules are found', async () => {
    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([], mockWallet, mockMintTask)
    );

    const result = await handleCopyMintEvent(mockCopyMintEvent);
    expect(result.status).toBe('skipped');
    expect(executeMintTask).not.toHaveBeenCalled();
  });

  it('skips mint when rule is disabled', async () => {
    const disabledRule = { ...mockRule, enabled: false };
    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([disabledRule], mockWallet, mockMintTask)
    );

    const result = await handleCopyMintEvent(mockCopyMintEvent);
    expect(result.status).toBe('skipped');
    expect(executeMintTask).not.toHaveBeenCalled();
  });

  it('skips mint when autoMint is false on matching rule', async () => {
    const noAutoRule = { ...mockRule, autoMint: false };
    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([noAutoRule], mockWallet, mockMintTask)
    );

    const result = await handleCopyMintEvent(mockCopyMintEvent);
    expect(result.status).toBe('skipped');
    expect(executeMintTask).not.toHaveBeenCalled();
  });

  it('skips mint when price exceeds rule maxPrice', async () => {
    const { fetchMintRequirements } = await import('@/lib/services/mint-requirements.service');
    (fetchMintRequirements as MockedFunction<typeof fetchMintRequirements>).mockResolvedValue({
      mintPrice: '0.5', // exceeds maxPrice of 0.1
      isSoldOut: false,
    } as Awaited<ReturnType<typeof fetchMintRequirements>>);

    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([mockRule], mockWallet, mockMintTask)
    );

    const result = await handleCopyMintEvent(mockCopyMintEvent);
    expect(result.status).toBe('skipped');
    expect(executeMintTask).not.toHaveBeenCalled();
  });

  it('skips mint when collection is sold out', async () => {
    const { fetchMintRequirements } = await import('@/lib/services/mint-requirements.service');
    (fetchMintRequirements as MockedFunction<typeof fetchMintRequirements>).mockResolvedValue({
      mintPrice: '0.05',
      isSoldOut: true,
    } as Awaited<ReturnType<typeof fetchMintRequirements>>);

    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([mockRule], mockWallet, mockMintTask)
    );

    const result = await handleCopyMintEvent(mockCopyMintEvent);
    expect(result.status).toBe('skipped');
  });

  it('skips mint when no wallet is available', async () => {
    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([mockRule], null, mockMintTask) // null wallet = no wallet found
    );

    const result = await handleCopyMintEvent(mockCopyMintEvent);
    expect(result.status).toBe('skipped');
    expect(executeMintTask).not.toHaveBeenCalled();
  });

  it('acquires and releases lock during execution', async () => {
    const { acquireLock, releaseLock } = await import('@/lib/services/mint-lock.service');
    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([mockRule], mockWallet, mockMintTask)
    );
    (executeMintTask as MockedFunction<typeof executeMintTask>).mockResolvedValue({
      status: 'completed',
      txHash: '0xabc',
    } as Awaited<ReturnType<typeof executeMintTask>>);

    await handleCopyMintEvent(mockCopyMintEvent);

    expect(acquireLock).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases lock even when executeMintTask throws', async () => {
    const { releaseLock } = await import('@/lib/services/mint-lock.service');
    (getDb as unknown as MockedFunction<() => unknown>).mockReturnValue(
      buildDbMock([mockRule], mockWallet, mockMintTask)
    );
    (executeMintTask as MockedFunction<typeof executeMintTask>).mockRejectedValue(
      new Error('RPC timeout')
    );

    await expect(handleCopyMintEvent(mockCopyMintEvent)).rejects.toThrow('RPC timeout');
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});

