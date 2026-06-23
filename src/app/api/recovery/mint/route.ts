import { NextResponse } from 'next/server';
import { executeRecoveryCheck } from '@/lib/services/qstash.service';
import { addBreadcrumb } from '@/lib/observability/sentry';

/**
 * POST /api/recovery/mint
 *
 * Manually trigger a stuck mint task recovery scan and start the
 * QStash self-scheduling loop (runs every 5 minutes automatically).
 *
 * Protected by CRON_SECRET environment variable.
 * Call once after deployment to bootstrap the recovery loop.
 */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  addBreadcrumb({ category: 'recovery', message: 'Manual recovery triggered', level: 'info' });

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
