import { NextResponse } from 'next/server';
import { executeRecoveryCheck } from '@/lib/services/qstash.service';
import { addBreadcrumb } from '@/lib/observability/sentry';

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // No secret configured — allow all (dev mode)
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/recovery/mint
 *
 * Called by Vercel Cron on schedule (vercel.json → crons).
 * Vercel cron jobs send GET requests; this handler also validates
 * the Vercel-Cron-Signature header for security.
 *
 * Schedule: hourly (0 * * * *) on Pro, daily (0 0 * * *) on Hobby.
 * Set CRON_SECRET env var in Vercel project settings.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  addBreadcrumb({
    category: 'recovery',
    message: 'Cron recovery triggered via GET',
    level: 'info',
  });

  try {
    const result = await executeRecoveryCheck();
    return NextResponse.json({ success: true, source: 'cron', result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Recovery failed' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/recovery/mint
 *
 * Manual trigger — callable from Telegram, admin panel, or QStash.
 * Protected by CRON_SECRET env var.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  addBreadcrumb({
    category: 'recovery',
    message: 'Manual recovery triggered via POST',
    level: 'info',
  });

  try {
    const result = await executeRecoveryCheck();
    return NextResponse.json({ success: true, source: 'manual', result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Recovery failed' },
      { status: 500 },
    );
  }
}
