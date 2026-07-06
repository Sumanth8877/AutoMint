/**
 * Security Finding C-2 — Test Suite
 *
 * Verifies that the Telegram webhook route:
 *  1.  Denies requests when TELEGRAM_WEBHOOK_SECRET is missing.
 *  2.  Denies requests with an invalid secret.
 *  3.  Denies requests with a missing header.
 *  4.  Denies requests with an empty header.
 *  5.  Denies requests where the header length differs from the secret length.
 *  6.  Allows requests with the exact correct secret.
 *  7.  Uses crypto.timingSafeEqual (timing-safe path).
 *  8.  Returns 200 when Telegram is disabled (no auth attempted).
 *  9.  Handles malformed JSON bodies with 400.
 * 10.  Never reaches command handlers when auth fails.
 *
 * Run: npx jest src/app/api/telegram/webhook/__tests__/webhook.security.test.ts
 */

// ── Module mocks ──────────────────────────────────────────────────────────────

import { vi, type MockedFunction } from 'vitest';

vi.mock('@/lib/services/telegram.service', () => ({
  isTelegramEnabled: vi.fn(),
  handleTelegramUpdate: vi.fn(),
}));

vi.mock('@/lib/api/errors', () => ({
  parseJsonBody: vi.fn(),
}));

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  const timingSafeEqual = vi.fn(actual.timingSafeEqual);
  return {
    ...actual,
    default: {
      ...actual,
      timingSafeEqual,
    },
    timingSafeEqual,
  };
});

import { isTelegramEnabled, handleTelegramUpdate } from '@/lib/services/telegram.service';
import { parseJsonBody } from '@/lib/api/errors';
import crypto from 'crypto';

const mockIsTelegramEnabled = isTelegramEnabled as MockedFunction<typeof isTelegramEnabled>;
const mockHandleTelegramUpdate = handleTelegramUpdate as MockedFunction<typeof handleTelegramUpdate>;
const mockParseJsonBody = parseJsonBody as MockedFunction<typeof parseJsonBody>;
const mockTimingSafeEqual = crypto.timingSafeEqual as MockedFunction<typeof crypto.timingSafeEqual>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-webhook-secret-32-chars-ok!!';

function makeRequest(secret?: string | null): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (secret !== null && secret !== undefined) {
    headers.set('x-telegram-bot-api-secret-token', secret);
  }
  return new Request('https://example.com/api/telegram/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify({ update_id: 1 }),
  });
}

describe('Security Finding C-2 — Telegram webhook authentication', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    // Default: Telegram enabled, secret present, handleTelegramUpdate is no-op
    mockIsTelegramEnabled.mockReturnValue(true);
    mockHandleTelegramUpdate.mockResolvedValue({ handled: true });
    mockParseJsonBody.mockResolvedValue({ update_id: 1 } as never);
    process.env.TELEGRAM_WEBHOOK_SECRET = VALID_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // ── 1. Valid secret ──────────────────────────────────────────────────────────
  describe('1 — valid secret', () => {
    it('returns 200 when the correct secret is provided', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest(VALID_SECRET));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('calls handleTelegramUpdate exactly once on success', async () => {
      const { POST } = await import('../route');
      await POST(makeRequest(VALID_SECRET));
      expect(mockHandleTelegramUpdate).toHaveBeenCalledTimes(1);
    });
  });

  // ── 2. Invalid secret ────────────────────────────────────────────────────────
  describe('2 — invalid secret', () => {
    it('returns 401 when the secret is wrong', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest('wrong-secret-value-here-!!!!!!!!'));
      expect(res.status).toBe(401);
      expect(mockHandleTelegramUpdate).not.toHaveBeenCalled();
    });

    it('never reaches handleTelegramUpdate with a wrong secret', async () => {
      const { POST } = await import('../route');
      await POST(makeRequest('attacker-crafted-secret-value-!!'));
      expect(mockHandleTelegramUpdate).not.toHaveBeenCalled();
    });
  });

  // ── 3. Missing secret env var ────────────────────────────────────────────────
  describe('3 — missing TELEGRAM_WEBHOOK_SECRET', () => {
    it('returns 401 when TELEGRAM_WEBHOOK_SECRET is not set', async () => {
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      // Re-import without the startup-throw guard by patching isTelegramEnabled to false
      // then back to true after import so the module-load guard doesn't throw.
      mockIsTelegramEnabled.mockReturnValueOnce(false);  // for startup check
      vi.resetModules();
      // Minimal re-mock
      vi.mock('@/lib/services/telegram.service', () => ({
        isTelegramEnabled: vi.fn().mockReturnValue(true), // now enabled for the actual POST
        handleTelegramUpdate: vi.fn(),
      }));
      vi.mock('@/lib/api/errors', () => ({ parseJsonBody: vi.fn() }));

      const { POST } = await import('../route');
      const res = await POST(makeRequest(VALID_SECRET));
      // Secret env var is gone → isAuthorized returns false → 401
      expect(res.status).toBe(401);

      const { handleTelegramUpdate: htu } = await import('@/lib/services/telegram.service');
      expect(htu).not.toHaveBeenCalled();
    });
  });

  // ── 4. Missing header ────────────────────────────────────────────────────────
  describe('4 — missing header', () => {
    it('returns 401 when the secret header is absent', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest(null));
      expect(res.status).toBe(401);
      expect(mockHandleTelegramUpdate).not.toHaveBeenCalled();
    });
  });

  // ── 5. Empty header ──────────────────────────────────────────────────────────
  describe('5 — empty header', () => {
    it('returns 401 when the secret header is an empty string', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest(''));
      expect(res.status).toBe(401);
      expect(mockHandleTelegramUpdate).not.toHaveBeenCalled();
    });
  });

  // ── 6. Different length header ───────────────────────────────────────────────
  describe('6 — different length header', () => {
    it('returns 401 when the header is shorter than the secret', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest('short'));
      expect(res.status).toBe(401);
      expect(mockHandleTelegramUpdate).not.toHaveBeenCalled();
    });

    it('returns 401 when the header is longer than the secret', async () => {
      const { POST } = await import('../route');
      const res = await POST(makeRequest(VALID_SECRET + '-extra-chars-appended'));
      expect(res.status).toBe(401);
      expect(mockHandleTelegramUpdate).not.toHaveBeenCalled();
    });

    it('still calls timingSafeEqual when lengths differ (fixed-length digest compare closes the length-timing leak)', async () => {
      // Security follow-up: secureCompare() hashes both the provided header
      // and the expected secret to a fixed-length SHA-256 digest *before*
      // comparing, so timingSafeEqual is always invoked — on equal-length
      // 32-byte buffers — regardless of how the raw input lengths compare.
      // This removes the early length-mismatch branch (and its associated
      // timing side-channel) that a naive `if (a.length !== b.length)
      // return false` + timingSafeEqual would have.
      mockTimingSafeEqual.mockClear();
      const { POST } = await import('../route');
      await POST(makeRequest('short'));
      expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
      const [buf1, buf2] = mockTimingSafeEqual.mock.calls[0];
      expect(Buffer.isBuffer(buf1)).toBe(true);
      expect(Buffer.isBuffer(buf2)).toBe(true);
      expect(buf1.length).toBe(32); // SHA-256 digest — fixed length regardless of input
      expect(buf2.length).toBe(32);
    });
  });

  // ── 7. Timing-safe comparison ────────────────────────────────────────────────
  describe('7 — timing-safe comparison', () => {
    it('calls crypto.timingSafeEqual when lengths match', async () => {
      mockTimingSafeEqual.mockClear();
      const { POST } = await import('../route');
      // Same-length wrong secret — forces timingSafeEqual to be called
      const sameLen = 'x'.repeat(VALID_SECRET.length);
      await POST(makeRequest(sameLen));
      expect(mockTimingSafeEqual).toHaveBeenCalledTimes(1);
    });

    it('calls timingSafeEqual with Buffer instances', async () => {
      mockTimingSafeEqual.mockClear();
      const { POST } = await import('../route');
      await POST(makeRequest(VALID_SECRET));
      const [buf1, buf2] = mockTimingSafeEqual.mock.calls[0];
      expect(Buffer.isBuffer(buf1)).toBe(true);
      expect(Buffer.isBuffer(buf2)).toBe(true);
    });
  });

  // ── 8. Telegram disabled ─────────────────────────────────────────────────────
  describe('8 — Telegram disabled', () => {
    it('returns 200 with disabled flag and skips auth entirely', async () => {
      mockIsTelegramEnabled.mockReturnValue(false);
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      const { POST } = await import('../route');
      // No secret header at all — should still return 200 because Telegram is disabled
      const res = await POST(makeRequest(null));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.disabled).toBe(true);
      expect(mockHandleTelegramUpdate).not.toHaveBeenCalled();
    });
  });

  // ── 9. Malformed request ─────────────────────────────────────────────────────
  describe('9 — malformed requests', () => {
    it('returns 400 for invalid JSON body', async () => {
      mockParseJsonBody.mockRejectedValueOnce(new Error('Invalid JSON request body'));
      const { POST } = await import('../route');
      const res = await POST(makeRequest(VALID_SECRET));
      expect(res.status).toBe(400);
    });

    it('returns 500 for unexpected errors during update handling', async () => {
      mockHandleTelegramUpdate.mockRejectedValueOnce(new Error('DB connection lost'));
      const { POST } = await import('../route');
      const res = await POST(makeRequest(VALID_SECRET));
      expect(res.status).toBe(500);
    });
  });

  // ── 10. Mint commands blocked when auth fails ────────────────────────────────
  describe('10 — mint commands never execute when auth fails', () => {
    it('does not call handleTelegramUpdate for any 401 case', async () => {
      const { POST } = await import('../route');
      const cases = [
        makeRequest(null),                            // missing header
        makeRequest(''),                              // empty header
        makeRequest('wrong'),                         // wrong (short)
        makeRequest('x'.repeat(VALID_SECRET.length)), // wrong (same length)
        makeRequest(VALID_SECRET + 'x'),              // wrong (longer)
      ];

      for (const req of cases) {
        vi.clearAllMocks();
        mockIsTelegramEnabled.mockReturnValue(true);
        const res = await POST(req);
        expect(res.status).toBe(401);
        expect(mockHandleTelegramUpdate).not.toHaveBeenCalled();
      }
    });
  });
});
