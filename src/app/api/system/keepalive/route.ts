import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { Client } from '@upstash/qstash';
import { addBreadcrumb } from '@/lib/observability/sentry';

/**
 * POST /api/system/keepalive
 *
 * Registers a QStash schedule that pings /api/health every 3 days,
 * keeping Neon's free-tier DB awake (suspends after 5 days of inactivity).
 *
 * Call ONCE after deployment — the schedule persists in QStash automatically.
 * Protected by CRON_SECRET so only you can register/reset it.
 *
 * To reset: DELETE the existing schedule from QStash dashboard, then POST here again.
 *
 * Usage:
 *   curl -X POST https://your-app.vercel.app/api/system/keepalive \
 *        -H "Authorization: Bearer <CRON_SECRET>"
 */
export const dynamic = 'force-dynamic';

function getAppOrigin(): string {
  const url =
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (!url) throw new Error('APP_URL or NEXT_PUBLIC_APP_URL must be set');
  return url.replace(/\/$/, '');
}

export async function POST(request: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const provided = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${cronSecret}`;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const authorized =
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Register QStash schedule ──────────────────────────────────────────────
  const qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    return NextResponse.json({ error: 'QSTASH_TOKEN is not configured' }, { status: 503 });
  }

  try {
    const client = new Client({ token: qstashToken });
    const origin = getAppOrigin();
    const healthUrl = `${origin}/api/health`;

    // M-03 fix: check for an existing keepalive schedule before creating a new one.
    // Each POST previously created a fresh cron schedule unconditionally.
    // Repeated calls (e.g. redeployment triggers) would accumulate duplicate
    // schedules, exhausting the QStash free-tier message quota.
    const existing = await client.schedules.list();
    const alreadyRegistered = existing.some(
      (s) => s.destination?.includes('/api/health') && s.destination?.includes(origin),
    );
    if (alreadyRegistered) {
      return NextResponse.json({
        ok: true,
        alreadyExists: true,
        message: 'Keepalive schedule already registered — no action taken.',
      });
    }

    // Every 3 days at 00:00 UTC — well within Neon’s 5-day suspend window.
    const schedule = await client.schedules.create({
      destination: healthUrl,
      cron: '0 0 */3 * *',
      retries: 2,
    });

    addBreadcrumb({
      category: 'keepalive',
      message: 'QStash keepalive schedule registered',
      level: 'info',
      data: { scheduleId: schedule.scheduleId, healthUrl },
    });

    return NextResponse.json({
      ok: true,
      scheduleId: schedule.scheduleId,
      healthUrl,
      cron: '0 0 */3 * *',
      message: 'Keepalive schedule registered. Neon DB will be pinged every 3 days.',
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// GET — shows current keepalive schedules so you can verify without the dashboard.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  const provided = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${cronSecret}`;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const authorized =
    providedBuf.length === expectedBuf.length &&
    timingSafeEqual(providedBuf, expectedBuf);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const qstashToken = process.env.QSTASH_TOKEN;
  if (!qstashToken) {
    return NextResponse.json({ error: 'QSTASH_TOKEN is not configured' }, { status: 503 });
  }

  try {
    const client = new Client({ token: qstashToken });
    const schedules = await client.schedules.list();
    const origin = getAppOrigin();
    const keepaliveSchedules = schedules.filter(s =>
      s.destination?.includes('/api/health') && s.destination?.includes(origin)
    );

    return NextResponse.json({
      ok: true,
      schedules: keepaliveSchedules.map(s => ({
        scheduleId: s.scheduleId,
        destination: s.destination,
        cron: s.cron,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
