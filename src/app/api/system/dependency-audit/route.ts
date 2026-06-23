/**
 * GET /api/system/dependency-audit
 *
 * Run a full dependency audit and return the structured report.
 * READ-ONLY — never modifies files or installs packages.
 *
 * Improvement 2: Redis report-level caching (1 hour TTL).
 * Subsequent calls within the hour return instantly from cache.
 * Add ?force=true to bypass the cache and run a fresh scan.
 *
 * Requires: authenticated user session.
 *
 * Query params:
 *   ?dev=false     Skip devDependencies (default: include them)
 *   ?force=true    Bypass the 1-hour report cache and force a fresh scan
 */

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { runDependencyAudit, type DependencyAuditReport } from '@/lib/services/dependency-audit.service';
import { captureException } from '@/lib/observability/sentry';
import { getCache, setCache, invalidateCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Report-level cache TTL: 1 hour
const REPORT_CACHE_TTL = 3_600;
const reportCacheKey = (includeDev: boolean) => `dep-report:${includeDev ? 'all' : 'prod'}`;

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const includeDev = searchParams.get('dev') !== 'false';
  const force = searchParams.get('force') === 'true';

  const cacheKey = reportCacheKey(includeDev);

  // Serve from cache unless force=true
  if (!force) {
    try {
      const cached = await getCache<DependencyAuditReport>(cacheKey);
      if (cached) {
        return NextResponse.json({ ok: true, report: cached, cached: true });
      }
    } catch { /* Redis unavailable — fall through to live scan */ }
  }

  try {
    const report = await runDependencyAudit({ devPackages: includeDev, concurrency: 8 });

    // Store the fresh report in Redis for 1 hour
    try {
      await setCache(cacheKey, report, REPORT_CACHE_TTL);
    } catch { /* non-fatal */ }

    return NextResponse.json({ ok: true, report, cached: false });
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

/**
 * DELETE /api/system/dependency-audit
 * Invalidate the cached report so the next GET triggers a fresh scan.
 */
export async function DELETE(request: Request) {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const includeDev = searchParams.get('dev') !== 'false';

  try {
    await invalidateCache(reportCacheKey(includeDev));
    await invalidateCache(reportCacheKey(!includeDev));
    return NextResponse.json({ ok: true, message: 'Report cache invalidated' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cache invalidation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
