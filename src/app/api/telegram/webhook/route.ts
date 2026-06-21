import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/api/errors';
import { handleTelegramUpdate, isTelegramEnabled, type TelegramUpdate } from '@/lib/services/telegram.service';
import { captureException } from '@/lib/observability/sentry';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return true;
  return request.headers.get('x-telegram-bot-api-secret-token') === expected;
}

export async function POST(request: Request) {
  if (!isTelegramEnabled()) {
    return NextResponse.json({ ok: true, disabled: true, reason: 'Telegram disabled by configuration' });
  }

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const update = await parseJsonBody<TelegramUpdate>(request);
    await handleTelegramUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    const message = error instanceof Error ? error.message : 'Telegram webhook failed';
    const status = message === 'Invalid JSON request body' ? 400 : 500;
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
