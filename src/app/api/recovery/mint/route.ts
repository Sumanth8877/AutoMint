import { NextResponse } from 'next/server';
import { executeRecoveryCheck } from '@/lib/services/qstash.service';
import { isAuthorizedBearer } from '@/lib/security/timing-safe-compare';

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

  // C-05 Fix: use a constant-time comparison to prevent timing oracle
  // attacks. A naive string comparison (===) short-circuits on the first
  // mismatched character, leaking information about how many leading
  // characters match. isAuthorizedBearer() hashes both sides to a
  // fixed-length digest before comparing, so it doesn't even leak the
  // secret's length via an early length-mismatch branch.
  const authorized = isAuthorizedBearer(request.headers.get('authorization'), cronSecret);

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
