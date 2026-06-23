/**
 * GET /api/system/dependency-audit/stream
 *
 * Improvement 3: SSE streaming endpoint for real-time scan progress.
 *
 * Streams Server-Sent Events as each package is audited so the UI
 * can show a live progress bar instead of a blank spinner.
 *
 * Events emitted:
 *   event: start    { total: number }
 *   event: progress { processed: number; total: number; packageName: string }
 *   event: complete { report: DependencyAuditReport; cached: boolean }
 *   event: error    { message: string }
 *
 * Requires: authenticated user session (Clerk cookie sent automatically
 * by the browser since this is a same-origin request).
 *
 * Query params:
 *   ?dev=false    Skip devDependencies (default: include them)
 *   ?force=true   Bypass the 1-hour report cache
 */

import { requireApiUser } from '@/lib/auth/require-auth';
import { runDependencyAudit, type DependencyAuditReport } from '@/lib/services/dependency-audit.service';
import { captureException } from '@/lib/observability/sentry';
import { getCache, setCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const REPORT_CACHE_TTL = 3_600;
const reportCacheKey = (includeDev: boolean) => `dep-report:${includeDev ? 'all' : 'prod'}`;

export async function GET(request: Request) {
  // Auth check must happen before the stream starts
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const includeDev = searchParams.get('dev') !== 'false';
  const force = searchParams.get('force') === 'true';

  const encoder = new TextEncoder();

  function encode(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(encode(event, data)); } catch { /* client disconnected */ }
      };

      // Check the cache first (unless force=true)
      if (!force) {
        try {
          const cached = await getCache<DependencyAuditReport>(reportCacheKey(includeDev));
          if (cached) {
            send('complete', { report: cached, cached: true });
            controller.close();
            return;
          }
        } catch { /* Redis unavailable — fall through */ }
      }

      // Read total package count from package.json so we can send it upfront
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const pkgPath = path.join(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const total = Object.keys({
          ...(pkg.dependencies ?? {}),
          ...(includeDev ? (pkg.devDependencies ?? {}) : {}),
        }).length;
        send('start', { total });
      } catch {
        send('start', { total: 0 });
      }

      try {
        const report = await runDependencyAudit({
          devPackages: includeDev,
          concurrency: 6,
          onProgress: (processed, total, packageName) => {
            send('progress', { processed, total, packageName });
          },
        });

        // Cache the result for 1 hour
        try {
          await setCache(reportCacheKey(includeDev), report, REPORT_CACHE_TTL);
        } catch { /* non-fatal */ }

        send('complete', { report, cached: false });
      } catch (error) {
        await captureException(error, {
          area: 'dependency-audit',
          context: { userId: auth.userId },
          fingerprint: ['dependency-audit', 'stream'],
        });
        send('error', { message: error instanceof Error ? error.message : 'Audit failed' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',    // Disable Nginx buffering
      'Connection': 'keep-alive',
    },
  });
}
