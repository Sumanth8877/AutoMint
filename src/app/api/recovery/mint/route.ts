import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { executeRecoveryCheck } from '@/lib/services/qstash.service';
import { addBreadcrumb } from '@/lib/observability/sentry';

/**
 * /api/recovery/mint
 *
 * Triggers a stuck mint task recovery scan and (re)starts the QStash
 * self-scheduling loop (the loop then runs every 5 minutes automatically).
 *
 * POST  — manual trigger (call once after deployment to bootstrap the loop;
 *         require Authorization: Bearer ${CRON_SECRET}).
 * GET   — Vercel cron heartbeat (L5 fix). Vercel cron always issues GET, and
 *         on Vercel-managed cron requests the platform attaches
 *         Authorization: Bearer ${CRON_SECRET} automatically. This guarantees
 *         the recovery loop is restarted on a fixed cadence even if the
 *         QStash self-schedule publish failed and no nonce-gap event fires.
 *
 * Both verbs share the same handler — the only behavioural difference is the
 * breadcrumb label so we can distinguish manual vs heartbeat invocations.
 */
export const dynamic = 'force-dynamic';

async function handle(request: Request, trigger: 'manual' | 'cron') {
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

  addBreadcrumb({
    category: 'recovery',
    message: trigger === 'cron' ? 'Cron heartbeat triggered recovery' : 'Manual recovery triggered',
    level: 'info',
    data: { trigger },
  });

  try {
    const result = await executeRecoveryCheck();
    return NextResponse.json({ success: true, trigger, result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Recovery failed' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handle(request, 'manual');
}

export async function GET(request: Request) {
  return handle(request, 'cron');
}
