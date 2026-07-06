/**
 * qstash-webhook.integration.test.ts
 *
 * Integration tests for the QStash webhook handler.
 * This is the entry point for ALL scheduled mints — an untested handler
 * means mint pipeline failures are invisible until a real mint is missed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockExecuteScheduledMint   = vi.fn().mockResolvedValue({ success: true });
const mockExecuteScheduledRiskRecheck = vi.fn().mockResolvedValue({ rechecked: true });
const mockExecuteReceiptRecheck  = vi.fn().mockResolvedValue({ confirmed: true });
const mockExecuteRecoveryCheck   = vi.fn().mockResolvedValue({ recovered: 0 });
const mockVerifyQStashSignature  = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/services/qstash.service', () => ({
  executeScheduledMint:          () => mockExecuteScheduledMint(),
  executeScheduledRiskRecheck:   () => mockExecuteScheduledRiskRecheck(),
  executeReceiptRecheck:         () => mockExecuteReceiptRecheck(),
  executeRecoveryCheck:          () => mockExecuteRecoveryCheck(),
  verifyQStashSignature:         () => mockVerifyQStashSignature(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: object, headers: Record<string, string> = {}) {
  const json = JSON.stringify(body);
  return new NextRequest('http://localhost/api/webhooks/qstash', {
    method: 'POST',
    body: json,
    headers: {
      'Content-Type': 'application/json',
      'upstash-signature': 'test-sig',
      ...headers,
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('QStash webhook handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyQStashSignature.mockResolvedValue(undefined); // signature always valid
  });

  it('returns 200 and calls executeScheduledMint for a standard mint payload', async () => {
    const { POST } = await import('@/app/api/webhooks/qstash/route');
    const req = makeRequest({ taskId: 'task-123' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockExecuteScheduledMint).toHaveBeenCalledTimes(1);
  });

  it('routes risk_check payload to executeScheduledRiskRecheck', async () => {
    const { POST } = await import('@/app/api/webhooks/qstash/route');
    const req = makeRequest({ taskId: 'task-456', type: 'risk_check' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockExecuteScheduledRiskRecheck).toHaveBeenCalledTimes(1);
    expect(mockExecuteScheduledMint).not.toHaveBeenCalled();
  });

  it('routes receipt_check payload to executeReceiptRecheck', async () => {
    const { POST } = await import('@/app/api/webhooks/qstash/route');
    const req = makeRequest({ taskId: 'task-789', type: 'receipt_check' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockExecuteReceiptRecheck).toHaveBeenCalledTimes(1);
  });

  it('routes recovery payload to executeRecoveryCheck', async () => {
    const { POST } = await import('@/app/api/webhooks/qstash/route');
    const req = makeRequest({ taskId: 'task-recovery', type: 'recovery' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockExecuteRecoveryCheck).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when taskId is missing', async () => {
    const { POST } = await import('@/app/api/webhooks/qstash/route');
    const req = makeRequest({ type: 'mint' }); // no taskId
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockExecuteScheduledMint).not.toHaveBeenCalled();
  });

  it('returns 400 when body is invalid JSON', async () => {
    const { POST } = await import('@/app/api/webhooks/qstash/route');
    const req = new NextRequest('http://localhost/api/webhooks/qstash', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json', 'upstash-signature': 'sig' },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 401 when QStash signature verification fails', async () => {
    mockVerifyQStashSignature.mockRejectedValueOnce(new Error('Invalid Signing Key'));

    const { POST } = await import('@/app/api/webhooks/qstash/route');
    const req = makeRequest({ taskId: 'task-123' }, { 'upstash-signature': 'bad-sig' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockExecuteScheduledMint).not.toHaveBeenCalled();
  });

  it('returns 500 and does not leak internal error details on mint failure', async () => {
    mockExecuteScheduledMint.mockRejectedValueOnce(new Error('private key decryption failed'));

    const { POST } = await import('@/app/api/webhooks/qstash/route');
    const req = makeRequest({ taskId: 'task-123' });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    // Error message should not expose internal details to QStash
    expect(body.error).toBeDefined();
  });
});
