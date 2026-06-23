/**
 * GET /api/system/dependency-audit
 *
 * Run a full dependency audit and return the structured report.
 * READ-ONLY — never modifies files or installs packages.
 *
 * Requires: authenticated user session.
 *
 * Query params:
 *   ?dev=false    Skip devDependencies (default: include them)
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { runDependencyAudit } from '@/lib/services/dependency-audit.service';
import { captureException } from '@/lib/observability/sentry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const includeDev = searchParams.get('dev') !== 'false';

  try {
    const report = await runDependencyAudit({ devPackages: includeDev, concurrency: 8 });
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    await captureException(error, {
      area: 'dependency-audit',
      context: { userId: auth.userId, includeDev },
      fingerprint: ['dependency-audit', 'api'],
    });
    const message = error instanceof Error ? error.message : 'Audit failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
