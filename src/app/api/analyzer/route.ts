import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { captureException } from '@/lib/observability/sentry';
import { AnalyzerExecutionError, AnalyzerResolutionError, runAnalyzer } from '@/lib/services/analyzer.service';

export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const limited = await enforceRateLimit(`analyzer:run:${authResult.userId}`, RATE_LIMITS.expensive);
    if (limited) return limited;

    const body = await parseJsonBody<{ input?: string }>(req);
    const input = body.input?.trim();

    if (!input) {
      return NextResponse.json({ error: 'Paste a launchpad URL or contract address to analyze.' }, { status: 400 });
    }

    const response = await runAnalyzer({ userId: authResult.userId, input });

    return NextResponse.json(response);
  } catch (error) {
    const status =
      error instanceof AnalyzerResolutionError ? 422 :
      error instanceof AnalyzerExecutionError  ? 500 : 500;

    const message =
      error instanceof Error ? error.message : 'Analyzer request failed';

    if (error instanceof AnalyzerExecutionError) {
      return NextResponse.json({ error: message, logs: error.logs }, { status });
    }

    if (status >= 500) {
      await captureException(error, {
        area: 'discovery',
        context: { route: '/api/analyzer' },
        fingerprint: ['analyzer', 'route'],
      });
    }

    return NextResponse.json({ error: message }, { status });
  }
}
