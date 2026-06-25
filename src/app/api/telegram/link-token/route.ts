import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { createTelegramLinkToken, getTelegramAccountByUserId, isTelegramEnabled } from '@/lib/services/telegram.service';

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const limited = await enforceRateLimit(`telegram:link-token:${authResult.userId}`, RATE_LIMITS.tokenGeneration);
    if (limited) return limited;

    if (!isTelegramEnabled()) {
      return NextResponse.json({
        enabled: false,
        token: null,
        linked: false,
        account: null,
        deepLink: null,
        expiresInSeconds: 0,
      });
    }

    const token = createTelegramLinkToken(authResult.userId);
    const account = await getTelegramAccountByUserId(authResult.userId);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');

    return NextResponse.json({
      token,
      linked: Boolean(account),
      account,
      deepLink: botUsername ? `https://t.me/${botUsername}?start=${encodeURIComponent(token)}` : null,
      expiresInSeconds: 600,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Telegram link token';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
