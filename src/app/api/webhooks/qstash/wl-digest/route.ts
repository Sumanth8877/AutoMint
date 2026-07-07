import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { verifyQStashSignature } from '@/lib/services/qstash.service';
import { runDailyDigest } from '@/lib/services/wl-digest.service';

// ─── WL Daily Digest cron endpoint ───────────────────────────────────────
// QStash should hit this once per day (recommended UTC 03:00 which is
// 08:30 IST — matches the user base's morning). Send one aggregated
// Telegram message per linked user listing today's pending WL check-ins.
//
// Timezone: if `?tz=<IANA name>` is passed, the digest uses it. Default UTC.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    await verifyQStashSignature(request.headers, rawBody);
  } catch (error) {
    logger.warn('WL digest cron: signature failed', { area: 'wl-digest', error: (error as Error).message });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Optional tz override from payload.
  let tz = 'UTC';
  try {
    const payload = JSON.parse(rawBody || '{}') as { tz?: string };
    if (payload.tz) tz = payload.tz;
  } catch { /* payload optional */ }

  try {
    const result = await runDailyDigest({ timezone: tz });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logger.error('WL digest cron: fatal', { area: 'wl-digest', error: (error as Error).message });
    return NextResponse.json({ error: 'Digest failed' }, { status: 500 });
  }
}

// Debug — same guard as the other WL crons.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('debug') !== '1') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || url.searchParams.get('token') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tz = url.searchParams.get('tz') ?? 'UTC';
  const result = await runDailyDigest({ timezone: tz });
  return NextResponse.json({ ok: true, ...result });
}
