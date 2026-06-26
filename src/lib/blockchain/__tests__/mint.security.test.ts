/**
 * Security Finding C-1 — Test Suite
 *
 * Verifies that executeMint() no longer uses process.env.PRIVATE_KEY,
 * correctly enforces per-user encrypted wallet signing, and fails safely
 * with sanitised error messages when validation requirements are not met.
 *
 * Coverage:
 *  1.  Valid wallet execution
 *  2.  PRIVATE_KEY env var ignored even when present
 *  3.  Missing walletId (undefined / empty object)
 *  4.  Blank walletId (whitespace)
 *  5.  Missing userId (empty string)
 *  6.  Blank userId (whitespace)
 *  7.  Wallet not found (DB lookup miss)
 *  8.  Wallet access denied (cross-user access attempt)
 *  9.  Wallet decryption failure (corrupted ciphertext)
 * 10.  Unauthorized execution (attacker userId, foreign walletId)
 * 11.  MINT_MODE !== 'live' blocks execution
 *
 * Invariants verified:
 *  - getWalletClient() is NEVER called when validation fails
 *  - getDecryptedPrivateKey() is the ONLY signing-key source
 *  - Returned error messages never contain walletId, crypto internals,
 *    or stack traces
 *
 * Run: npx jest src/lib/blockchain/__tests__/mint.security.test.ts
 */

import { executeMint, type MintParams } from '../mint';

// ── Module mocks ──────────────────────────────────────────────────────────────

import { vi, type MockedFunction } from 'vitest';

vi.mock('@/lib/services/wallet.service', () => ({
  getDecryptedPrivateKey: vi.fn(),
}));

vi.mock('@/lib/services/rpc-manager.service', () => ({
  getWalletClient: vi.fn(),
}));

vi.mock('../client', () => ({
  getClient: vi.fn(),
}));

vi.mock('@/lib/observability/sentry', () => ({
  captureException: vi.fn().mockResolvedValue(undefined),
  captureMessage: vi.fn().mockResolvedValue(undefined),
}));

import { getDecryptedPrivateKey } from '@/lib/services/wallet.service';
import { getWalletClient } from '@/lib/services/rpc-manager.service';
import { getClient } from '../client';

const mockGetDecryptedPrivateKey = getDecryptedPrivateKey as MockedFunction<typeof getDecryptedPrivateKey>;
const mockGetWalletClient = getWalletClient as MockedFunction<typeof getWalletClient>;
const mockGetClient = getClient as MockedFunction<typeof getClient>;

// ── Test fixtures ─────────────────────────────────────────────────────────────

const WALLET_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as `0x${string}`;
const CHAIN = 'base';
const CONTRACT = '0x1234567890123456789012345678901234567890' as `0x${string}`;
const USER_ID = 'user_abc123';
const WALLET_ID = 'wallet_xyz789';
// Hardhat well-known test key — never used in production
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TX_HASH = '0xdeadbeef00000000000000000000000000000000000000000000000000000001' as `0x${string}`;

const BASE_PARAMS: MintParams = {
  contractAddress: CONTRACT,
  quantity: 1,
};

// ── Shared mock builders ──────────────────────────────────────────────────────

function setupLiveMode() {
  process.env.MINT_MODE = 'live';
}

function setupPublicClientMocks(status: 'success' | 'reverted' = 'success') {
  mockGetClient.mockReturnValue({
    call: vi.fn().mockResolvedValue({}),
    estimateGas: vi.fn().mockResolvedValue(BigInt(21000)),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      status,
      gasUsed: BigInt(21000),
      blockNumber: BigInt(100),
    }),
    readContract: vi.fn().mockResolvedValue(true),
  } as unknown as Parameters<typeof mockGetClient.mockReturnValue>[0]);
}

function setupWalletClientMock(txHash: `0x${string}` = TX_HASH) {
  mockGetWalletClient.mockReturnValue({
    sendTransaction: vi.fn().mockResolvedValue(txHash),
  } as unknown as Parameters<typeof mockGetWalletClient.mockReturnValue>[0]);
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Security Finding C-1 — executeMint()', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment before every test
    process.env = { ...originalEnv };
    delete process.env.PRIVATE_KEY;
    setupLiveMode();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── 1. Valid wallet execution ─────────────────────────────────────────────
  describe('1 — valid wallet execution', () => {
    it('decrypts per-user key, sends transaction, and returns txHash', async () => {
      mockGetDecryptedPrivateKey.mockResolvedValue(TEST_PRIVATE_KEY);
      setupPublicClientMocks();
      setupWalletClientMock();

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      expect(result.success).toBe(true);
      expect(result.txHash).toBe(TX_HASH);
      expect(result.error).toBeUndefined();
    });

    it('calls getDecryptedPrivateKey with correct (walletId, userId) pair', async () => {
      mockGetDecryptedPrivateKey.mockResolvedValue(TEST_PRIVATE_KEY);
      setupPublicClientMocks();
      setupWalletClientMock();

      await executeMint(WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID });

      expect(mockGetDecryptedPrivateKey).toHaveBeenCalledWith(WALLET_ID, USER_ID);
      expect(mockGetDecryptedPrivateKey).toHaveBeenCalledTimes(1);
    });

    it('accepts a private key that lacks the 0x prefix', async () => {
      // Some wallet storage strips the 0x prefix
      const keyWithoutPrefix = TEST_PRIVATE_KEY.slice(2);
      mockGetDecryptedPrivateKey.mockResolvedValue(keyWithoutPrefix);
      setupPublicClientMocks();
      setupWalletClientMock();

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      expect(result.success).toBe(true);
    });
  });

  // ── 2. PRIVATE_KEY env var is never accessed ──────────────────────────────
  describe('2 — PRIVATE_KEY env var ignored', () => {
    it('does not use process.env.PRIVATE_KEY even when it is set', async () => {
      process.env.PRIVATE_KEY = 'env-key-must-never-be-used-0000000000000000000000000000000000';
      mockGetDecryptedPrivateKey.mockResolvedValue(TEST_PRIVATE_KEY);
      setupPublicClientMocks();
      setupWalletClientMock();

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      // Transaction must succeed via the per-user key — not the env var
      expect(result.success).toBe(true);
      // The only key source must be getDecryptedPrivateKey
      expect(mockGetDecryptedPrivateKey).toHaveBeenCalledTimes(1);
    });

    it('fails (wallet error) even when PRIVATE_KEY is set but wallet lookup fails', async () => {
      process.env.PRIVATE_KEY = 'env-key-must-never-be-used-0000000000000000000000000000000000';
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(new Error('Wallet not found'));

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      // CRITICAL: must not broadcast a transaction using the env key
      expect(mockGetWalletClient).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
    });
  });

  // ── 3. Missing walletId ───────────────────────────────────────────────────
  describe('3 — missing walletId', () => {
    it('fails when walletId is an empty string', async () => {
      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: '' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/wallet/i);
      expect(mockGetDecryptedPrivateKey).not.toHaveBeenCalled();
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });
  });

  // ── 4. Blank walletId ─────────────────────────────────────────────────────
  describe('4 — blank walletId (whitespace)', () => {
    it('fails when walletId is only whitespace', async () => {
      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: '   ' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/wallet/i);
      expect(mockGetDecryptedPrivateKey).not.toHaveBeenCalled();
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('fails for tab-only walletId', async () => {
      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: '\t' },
      );

      expect(result.success).toBe(false);
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });
  });

  // ── 5. Missing userId ─────────────────────────────────────────────────────
  describe('5 — missing userId', () => {
    it('fails when userId is an empty string', async () => {
      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, '', { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/user|authenticated/i);
      expect(mockGetDecryptedPrivateKey).not.toHaveBeenCalled();
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });
  });

  // ── 6. Blank userId ───────────────────────────────────────────────────────
  describe('6 — blank userId (whitespace)', () => {
    it('fails when userId is only whitespace', async () => {
      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, '   ', { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/user|authenticated/i);
      expect(mockGetDecryptedPrivateKey).not.toHaveBeenCalled();
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('fails for newline-only userId', async () => {
      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, '\n', { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });
  });

  // ── 7. Wallet not found ───────────────────────────────────────────────────
  describe('7 — wallet not found', () => {
    it('returns sanitised error when DB lookup finds no wallet', async () => {
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(new Error('Wallet not found'));

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      // Sanitised — must match "not found or access denied" without walletId value
      expect(result.error).toMatch(/not found|access denied/i);
      // Must NOT expose the walletId in the returned error
      expect(result.error).not.toContain(WALLET_ID);
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('does not expose walletId in error for missing wallet', async () => {
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(new Error('Wallet not found'));

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: 'secret-wallet-id-42' },
      );

      expect(result.error).not.toContain('secret-wallet-id-42');
    });
  });

  // ── 8. Wallet access denied ───────────────────────────────────────────────
  describe('8 — wallet access denied (cross-user)', () => {
    it('returns sanitised error when an attacker tries a different user wallet', async () => {
      setupPublicClientMocks();
      // DB predicate wallets.userId = attackerUserId will find nothing
      mockGetDecryptedPrivateKey.mockRejectedValue(new Error('Wallet not found'));

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS,
        'attacker_user_99',          // wrong user
        { walletId: WALLET_ID },     // wallet owned by USER_ID
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found|access denied/i);
      // CRITICAL: no transaction was sent
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('does not fall back to PRIVATE_KEY when wallet ownership check fails', async () => {
      process.env.PRIVATE_KEY = 'fallback-must-never-be-used-000000000000000000000000000000000';
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(new Error('Wallet not found'));

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS,
        'attacker_user_99',
        { walletId: 'foreign_wallet_id' },
      );

      expect(result.success).toBe(false);
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });
  });

  // ── 9. Wallet decryption failure ──────────────────────────────────────────
  describe('9 — wallet decryption failure', () => {
    it('returns sanitised error when AES-GCM auth tag is invalid', async () => {
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(
        new Error('Unsupported state or unable to authenticate data'),
      );

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      // Sanitised: must not expose crypto internals
      expect(result.error).not.toMatch(/authentication tag|auth tag|aes|gcm|cipher/i);
      expect(result.error).not.toMatch(/stack/i);
      expect(result.error).toMatch(/wallet key unavailable/i);
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('returns sanitised error when encrypted payload format is invalid', async () => {
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(
        new Error('Encrypted value format is invalid'),
      );

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      expect(result.error).not.toMatch(/encrypted value format/i);
      expect(result.error).toMatch(/wallet key unavailable/i);
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('returns sanitised error when wallet has no private key stored', async () => {
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(
        new Error('Wallet does not have an imported private key'),
      );

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      // "not found" in original message — classified as access denied by the fix
      expect(result.error).toMatch(/not found|access denied|wallet key unavailable/i);
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });
  });

  // ── 10. Unauthorized execution attempts ──────────────────────────────────
  describe('10 — unauthorized execution attempts', () => {
    it('never reaches getWalletClient() when userId is empty', async () => {
      await executeMint(WALLET_ADDRESS, CHAIN, BASE_PARAMS, '', { walletId: WALLET_ID });
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('never reaches getWalletClient() when walletId is empty', async () => {
      await executeMint(WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: '' });
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('never reaches getWalletClient() when wallet lookup fails', async () => {
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(new Error('Wallet not found'));
      await executeMint(WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID });
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('never reaches getWalletClient() when decryption fails', async () => {
      setupPublicClientMocks();
      mockGetDecryptedPrivateKey.mockRejectedValue(
        new Error('Unsupported state or unable to authenticate data'),
      );
      await executeMint(WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID });
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('getDecryptedPrivateKey is the sole key source across all valid calls', async () => {
      mockGetDecryptedPrivateKey.mockResolvedValue(TEST_PRIVATE_KEY);
      setupPublicClientMocks();
      setupWalletClientMock();

      await executeMint(WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID });

      // Exactly one key fetch — no env fallback, no secondary source
      expect(mockGetDecryptedPrivateKey).toHaveBeenCalledTimes(1);
    });
  });

  // ── 11. MINT_MODE guard ───────────────────────────────────────────────────
  describe('11 — MINT_MODE !== live', () => {
    it('blocks execution when MINT_MODE=simulation', async () => {
      process.env.MINT_MODE = 'simulation';
      process.env.NODE_ENV = 'test';

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/MINT_MODE/);
      expect(mockGetDecryptedPrivateKey).not.toHaveBeenCalled();
      expect(mockGetWalletClient).not.toHaveBeenCalled();
    });

    it('blocks execution when MINT_MODE is unset in non-production', async () => {
      delete process.env.MINT_MODE;
      process.env.NODE_ENV = 'test';

      const result = await executeMint(
        WALLET_ADDRESS, CHAIN, BASE_PARAMS, USER_ID, { walletId: WALLET_ID },
      );

      expect(result.success).toBe(false);
      expect(mockGetDecryptedPrivateKey).not.toHaveBeenCalled();
    });
  });
});
