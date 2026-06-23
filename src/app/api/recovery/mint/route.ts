import { NextResponse } from 'next/server';
import { executeRecoveryCheck } from '@/lib/services/qstash.service';
import { addBreadcrumb } from '@/lib/observability/sentry';

/**
 * POST /api/recovery/mint
 *
 * Trigger a stuck mint task recovery scan.
 *
 * Designed to be called by Vercel cron (add to vercel.json):
 *   { "path": "/api/recovery/mint", "schedule": "every 5 minutes" }
 *
 * Can also be called manually for immediate recovery.
 *
 * Protected by CRON_SECRET environment variable.
 */
export async function POST(request: Request) {
  // Validate the request comes from Vercel cron or an authorised caller
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  addBreadcrumb({
    category: 'recovery',
    message: 'Recovery endpoint triggered',
    level: 'info',
    data: { source: authHeader ? 'authorized' : 'open' },
  });

  try {
    const result = await executeRecoveryCheck();
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Recovery failed' },
      { status: 500 },
    );
  }
}
