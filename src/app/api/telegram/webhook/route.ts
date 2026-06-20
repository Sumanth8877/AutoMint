import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/api/errors';
import { handleTelegramUpdate, type TelegramUpdate } from '@/lib/services/telegram.service';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return true;
  return request.headers.get('x-telegram-bot-api-secret-token') === expected;
}

export async function POST(request: Request) {
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
    return NextResponse.json({ error: message }, { status });
  }
}
