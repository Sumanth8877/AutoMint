import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getSystemStatusSnapshot } from '@/lib/services/system-status.service';
import { captureException } from '@/lib/observability/sentry';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/system/status
//
// Aggregated health snapshot for the Settings > System status panel: DB,
// Redis, RPC provider circuit-breaker state, the recovery-loop heartbeat,
// and recently failed jobs (both app-level mint task failures and QStash's
// own dead-letter queue).
export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const snapshot = await getSystemStatusSnapshot(authResult.userId);
    return NextResponse.json(snapshot);
  } catch (error) {
    captureException(error, { area: 'system-status', context: { route: '/api/system/status' }, fingerprint: ['system-status'] });
    return NextResponse.json({ error: 'Failed to load system status' }, { status: 500 });
  }
}
