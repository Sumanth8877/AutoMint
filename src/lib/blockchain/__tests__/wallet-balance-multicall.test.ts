/**
 * wallet-balance-multicall.test.ts
 *
 * Improvement: batch native-balance checks across many wallets into a
 * single Multicall3 call instead of one getBalance() RPC per wallet
 * (matters for both latency during a fanout mint and metered RPC cost).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMulticall = vi.hoisted(() => vi.fn());
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

vi.mock('@/lib/blockchain/client', () => ({
  getClient: vi.fn().mockReturnValue({
    multicall: mockMulticall,
    chain: { contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } } },
  }),
}));

vi.mock('@/lib/observability/sentry', () => ({
  captureException: vi.fn(),
}));

import { getWalletBalancesMulticall } from '../wallet';

const ADDR_A = '0x1111111111111111111111111111111111111111';
const ADDR_B = '0x2222222222222222222222222222222222222222';
const ADDR_C = '0x3333333333333333333333333333333333333333';

describe('getWalletBalancesMulticall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues exactly one multicall for N addresses (not N individual calls)', async () => {
    mockMulticall.mockResolvedValue([
      { status: 'success', result: 1_000000000000000000n }, // 1 ETH
      { status: 'success', result: 500000000000000000n },   // 0.5 ETH
    ]);

    await getWalletBalancesMulticall([ADDR_A, ADDR_B], 'ethereum');

    expect(mockMulticall).toHaveBeenCalledTimes(1);
  });

  it('routes every call through the chain\'s Multicall3 contract getEthBalance', async () => {
    mockMulticall.mockResolvedValue([{ status: 'success', result: 0n }]);

    await getWalletBalancesMulticall([ADDR_A], 'ethereum');

    const callArgs = mockMulticall.mock.calls[0][0];
    expect(callArgs.contracts).toHaveLength(1);
    expect(callArgs.contracts[0].address).toBe(MULTICALL3_ADDRESS);
    expect(callArgs.contracts[0].functionName).toBe('getEthBalance');
    expect(callArgs.contracts[0].args).toEqual([ADDR_A]);
    expect(callArgs.allowFailure).toBe(true);
  });

  it('returns formatted ETH balances in the same order as the input addresses', async () => {
    mockMulticall.mockResolvedValue([
      { status: 'success', result: 2_000000000000000000n }, // 2 ETH
      { status: 'success', result: 1_500000000000000000n }, // 1.5 ETH
      { status: 'success', result: 0n },
    ]);

    const results = await getWalletBalancesMulticall([ADDR_A, ADDR_B, ADDR_C], 'ethereum');

    expect(results).toEqual([
      { address: ADDR_A, balance: '2', symbol: 'ETH' },
      { address: ADDR_B, balance: '1.5', symbol: 'ETH' },
      { address: ADDR_C, balance: '0', symbol: 'ETH' },
    ]);
  });

  it('isolates a single failed lookup instead of failing the whole batch', async () => {
    mockMulticall.mockResolvedValue([
      { status: 'success', result: 1_000000000000000000n },
      { status: 'failure', error: new Error('RPC timeout') },
    ]);

    const results = await getWalletBalancesMulticall([ADDR_A, ADDR_B], 'ethereum');

    expect(results[0]).toEqual({ address: ADDR_A, balance: '1', symbol: 'ETH' });
    expect(results[1]).toMatchObject({ address: ADDR_B, balance: '0', error: 'RPC timeout' });
  });

  it('returns an empty array without calling multicall for an empty address list', async () => {
    const results = await getWalletBalancesMulticall([], 'ethereum');
    expect(results).toEqual([]);
    expect(mockMulticall).not.toHaveBeenCalled();
  });

  it('fails closed (zero balance per address) rather than throwing if multicall itself errors', async () => {
    mockMulticall.mockRejectedValue(new Error('RPC unavailable'));

    const results = await getWalletBalancesMulticall([ADDR_A, ADDR_B], 'ethereum');

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.balance === '0' && r.error)).toBe(true);
  });

  it('uses the correct native symbol for a non-ETH chain (Polygon → POL)', async () => {
    mockMulticall.mockResolvedValue([{ status: 'success', result: 0n }]);

    const results = await getWalletBalancesMulticall([ADDR_A], 'polygon');

    expect(results[0].symbol).toBe('POL');
  });
});
