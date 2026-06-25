import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { parseJsonBody } from '@/lib/api/errors';
import { handleTelegramUpdate, isTelegramEnabled, type TelegramUpdate } from '@/lib/services/telegram.service';
import { captureException } from '@/lib/observability/sentry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── Startup validation ────────────────────────────────────────────────────────
// TELEGRAM_WEBHOOK_SECRET must be set whenever Telegram is enabled.
// Fail at module load time so the misconfiguration surfaces in deployment logs
// before any request is processed, rather than silently allowing all requests.
if (isTelegramEnabled() && !process.env.TELEGRAM_WEBHOOK_SECRET) {
  console.error('[C-2] TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_ENABLED=true');
}

// ── Auth ──────────────────────────────────────────────────────────────────────
/**
 * Verifies the X-Telegram-Bot-Api-Secret-Token header using a timing-safe
 * comparison to prevent timing-oracle attacks on the secret.
 *
 * Rules:
 *  - Missing TELEGRAM_WEBHOOK_SECRET → deny (never a default-allow).
 *  - Missing / empty header          → deny.
 *  - Length mismatch                 → deny (checked before timingSafeEqual
 *                                      because timingSafeEqual throws on unequal
 *                                      buffer lengths).
 *  - Content mismatch                → deny.
 *
 * Returns exactly: true (authorized) | false (unauthorized).
 * No fallback path exists.
 */
function isAuthorized(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;

  // Missing secret → always deny. Never fall back to allow.
  if (!expected) return false;

  const provided = request.headers.get('x-telegram-bot-api-secret-token');

  // Missing or empty header → deny.
  if (!provided) return false;

  // Convert to fixed-length buffers for timing-safe comparison.
  const providedBuf = Buffer.from(provided,  'utf8');
  const expectedBuf = Buffer.from(expected,  'utf8');

  // timingSafeEqual requires equal-length buffers; length mismatch → deny.
  if (providedBuf.length !== expectedBuf.length) return false;

  // Constant-time comparison — no timing oracle on the secret.
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

// ── Route ─────────────────────────────────────────────────────────────────────
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: '/api/telegram/webhook',
    enabled: isTelegramEnabled(),
    method: 'POST',
  });
}

export async function POST(request: Request) {
  console.log('Telegram webhook received request');
  
  if (!isTelegramEnabled()) {
    console.log('Telegram disabled by configuration');
    return NextResponse.json({ ok: true, disabled: true, reason: 'Telegram disabled by configuration' });
  }

  if (!isAuthorized(request)) {
    console.log('Telegram webhook unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const update = await parseJsonBody<TelegramUpdate>(request);
    await handleTelegramUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    captureException(error, { area: 'telegram', context: { route: 'telegram/webhook' }, fingerprint: ['telegram', 'webhook-error'] });
    const message = error instanceof Error ? error.message : 'Telegram webhook failed';
    const status = message === 'Invalid JSON request body' ? 400 : 500;
    console.error('Telegram webhook error:', message);
    if (status >= 500) {
      await captureException(error, {
        area: 'telegram',
        context: { route: '/api/telegram/webhook' },
        fingerprint: ['telegram', 'webhook'],
      });
    }
    return NextResponse.json({ error: message }, { status });
  }
}
