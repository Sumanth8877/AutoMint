import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { verifyQStashSignature } from '@/lib/services/qstash.service';
import { runWatcherCron } from '@/lib/services/wl-watcher.service';

// ─── WL Tracker cron endpoint ────────────────────────────────────────────
// QStash hits this every N minutes (recommended: every 2 minutes so we can
// service 5-minute projects on time). The handler:
//   1. Verifies the QStash signature.
//   2. Runs `runWatcherCron()` which picks up all projects due for a check
//      based on their per-project poll_frequency_minutes.
//
// This route replaces a traditional Vercel cron because QStash provides
// signature verification, dead-letter retries, and much better observability.
// A separate manual trigger via `?debug=1&token=<TELEGRAM_WEBHOOK_SECRET>`
// exists purely for local development — never invoke it from production.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// This endpoint can run up to 60s while a batch of projects is processed.
// Set explicitly so Vercel's default (10s for Hobby) doesn't cut it short.
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    await verifyQStashSignature(request.headers, rawBody);
  } catch (error) {
    logger.warn('WL cron: QStash signature verification failed', {
      area: 'wl-cron',
      error: (error as Error).message,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  try {
    const results = await runWatcherCron();
    const durationMs = Date.now() - started;

    const summary = {
      projectsChecked: results.length,
      totalNewTweets: results.reduce((n, r) => n + r.newTweetsSeen, 0),
      totalPersisted: results.reduce((n, r) => n + r.tweetsPersisted, 0),
      totalNotified: results.reduce((n, r) => n + r.notificationsSent, 0),
      errors: results.filter((r) => r.status === 'error').length,
      durationMs,
    };

    logger.info('WL cron: complete', { area: 'wl-cron', ...summary });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    logger.error('WL cron: fatal error', {
      area: 'wl-cron',
      error: (error as Error).message,
    });
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}

// Manual invocation for local debugging — guarded by the same shared secret
// as the Telegram webhook. Never exposed in prod as long as
// TELEGRAM_WEBHOOK_SECRET is set to a strong value.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('debug') !== '1') {
    return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  }
  const token = url.searchParams.get('token');
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const results = await runWatcherCron();
  return NextResponse.json({ ok: true, results });
}
