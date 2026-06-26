import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
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
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }

  // C-05 Fix: use timingSafeEqual to prevent timing oracle attacks.
  // A naive string comparison (===) short-circuits on the first mismatched
  // character, leaking information about how many leading characters match.
  // A sophisticated attacker measuring response latency could reconstruct
  // CRON_SECRET character by character.
  // timingSafeEqual always takes the same time regardless of where the
  // strings diverge, closing this side channel completely.
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
