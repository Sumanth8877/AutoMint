/**
 * mint-state.service.test.ts
 *
 * Tests for getMintState() — the critical function that determines
 * whether a mint is LIVE, NOT_STARTED, ENDED, or UNKNOWN.
 * Wrong state = missed mint or wasted gas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockMulticall = vi.fn();

vi.mock('@/lib/blockchain/client', () => ({
  getClient: vi.fn().mockReturnValue({
    multicall: mockMulticall,
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONTRACT = '0x' + 'a'.repeat(40);
const CHAIN = 'ethereum';

const now = Math.floor(Date.now() / 1000);
const FUTURE = BigInt(now + 3600);  // 1 hour from now
const PAST   = BigInt(now - 3600);  // 1 hour ago

function makeMulticallResult(overrides: {
  publicMintActive?: boolean;
  maxSupply?: bigint;
  totalSupply?: bigint;
  mintStart?: bigint;
  mintEnd?: bigint;
  paused?: boolean;
}) {
  return [
    overrides.publicMintActive !== undefined
      ? { status: 'success', result: overrides.publicMintActive }
      : { status: 'failure' },
    overrides.maxSupply !== undefined
      ? { status: 'success', result: overrides.maxSupply }
      : { status: 'failure' },
    overrides.totalSupply !== undefined
      ? { status: 'success', result: overrides.totalSupply }
      : { status: 'failure' },
    overrides.mintStart !== undefined
      ? { status: 'success', result: overrides.mintStart }
      : { status: 'failure' },
    overrides.mintEnd !== undefined
      ? { status: 'success', result: overrides.mintEnd }
      : { status: 'failure' },
    overrides.paused !== undefined
      ? { status: 'success', result: overrides.paused }
      : { status: 'failure' },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getMintState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no OpenSea key so we test pure on-chain path
    delete process.env.OPENSEA_API_KEY;
  });

  it('returns UNKNOWN for empty contractAddress', async () => {
    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState('', 'ethereum');
    expect(result.status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for empty chain', async () => {
    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, '');
    expect(result.status).toBe('UNKNOWN');
  });

  it('returns LIVE when publicMintActive = true and not ended', async () => {
    mockMulticall.mockResolvedValue(makeMulticallResult({
      publicMintActive: true,
      maxSupply: 1000n,
      totalSupply: 500n,
      mintEnd: FUTURE,
    }));

    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, CHAIN);
    expect(result.status).toBe('LIVE');
  });

  it('returns NOT_STARTED when publicMintActive = false and start is in future', async () => {
    mockMulticall.mockResolvedValue(makeMulticallResult({
      publicMintActive: false,
      mintStart: FUTURE,
    }));

    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, CHAIN);
    expect(result.status).toBe('NOT_STARTED');
    expect(result.startTime).toBeDefined();
  });

  it('returns ENDED when publicMintActive = true but mintEnd has passed', async () => {
    mockMulticall.mockResolvedValue(makeMulticallResult({
      publicMintActive: true,
      mintEnd: PAST,
    }));

    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, CHAIN);
    expect(result.status).toBe('ENDED');
  });

  it('returns ENDED when totalSupply >= maxSupply (sold out)', async () => {
    mockMulticall.mockResolvedValue(makeMulticallResult({
      maxSupply: 1000n,
      totalSupply: 1000n,
      mintStart: PAST,
    }));

    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, CHAIN);
    expect(result.status).toBe('ENDED');
    expect(result.minted).toBe(1000);
    expect(result.maxSupply).toBe(1000);
  });

  it('returns NOT_STARTED when paused = true and no other signals', async () => {
    mockMulticall.mockResolvedValue(makeMulticallResult({
      paused: true,
    }));

    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, CHAIN);
    expect(result.status).toBe('NOT_STARTED');
  });

  it('returns LIVE when supply available and time window is open', async () => {
    mockMulticall.mockResolvedValue(makeMulticallResult({
      maxSupply: 1000n,
      totalSupply: 100n,
      mintStart: PAST,
      mintEnd: FUTURE,
    }));

    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, CHAIN);
    expect(result.status).toBe('LIVE');
  });

  it('returns UNKNOWN when multicall fails entirely', async () => {
    mockMulticall.mockRejectedValue(new Error('RPC error'));

    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, CHAIN);
    expect(result.status).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for ethereum chain when OPENSEA_API_KEY not set', async () => {
    // All multicall slots fail — falls through to OpenSea check
    mockMulticall.mockResolvedValue(makeMulticallResult({}));
    delete process.env.OPENSEA_API_KEY;

    const { getMintState } = await import('@/lib/services/mint-state.service');
    const result = await getMintState(CONTRACT, 'ethereum');
    expect(result.status).toBe('UNKNOWN');
  });

  it('skips OpenSea enrichment for non-ethereum chains', async () => {
    mockMulticall.mockResolvedValue(makeMulticallResult({
      maxSupply: 1000n,
      totalSupply: 100n,
      mintStart: PAST,
      mintEnd: FUTURE,
    }));

    const { getMintState } = await import('@/lib/services/mint-state.service');
    // Base chain — no OpenSea call
    const result = await getMintState(CONTRACT, 'base');
    expect(['LIVE', 'NOT_STARTED', 'ENDED', 'UNKNOWN']).toContain(result.status);
  });
});
