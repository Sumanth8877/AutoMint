import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { parseJsonBody } from '@/lib/api/errors';
import { captureException } from '@/lib/observability/sentry';
import { AnalyzerResolutionError, runAnalyzer } from '@/lib/services/analyzer.service';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Analyzer request failed';
}

export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ input?: string }>(req);
    const input = body.input?.trim();

    if (!input) {
      return NextResponse.json({ error: 'Paste a launchpad URL or contract address to analyze.' }, { status: 400 });
    }

    const response = await runAnalyzer({ userId: authResult.userId, input });

    return NextResponse.json(response);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = error instanceof AnalyzerResolutionError ? error.status : message === 'Invalid JSON request body' ? 400 : 500;
    if (error instanceof AnalyzerResolutionError) {
      return NextResponse.json({ error: message, intent: error.intent, logs: error.logs }, { status });
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
