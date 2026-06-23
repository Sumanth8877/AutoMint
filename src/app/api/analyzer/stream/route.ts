import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { captureException } from '@/lib/observability/sentry';
import { AnalyzerExecutionError, AnalyzerResolutionError, runAnalyzer } from '@/lib/services/analyzer.service';

export const dynamic = 'force-dynamic';

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

    // Rate limit: analyzer/stream fans out to AI + RPC — expensive per call
    const rateLimited = await enforceRateLimit(`analyzer:stream:${authResult.userId}`, RATE_LIMITS.expensive);
    if (rateLimited) return rateLimited;

  let input = '';
  try {
    const body = await parseJsonBody<{ input?: string }>(req);
    input = body.input?.trim() ?? '';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
  }

  if (!input) {
    return NextResponse.json({ error: 'Paste a launchpad URL or contract address to analyze.' }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      void runAnalyzer({
        userId: authResult.userId,
        input,
        onLog: (entry) => send('log', entry),
      }).then((result) => {
        send('result', result);
      }).catch(async (error) => {
        const message = getErrorMessage(error, 'Analyzer request failed');
        if (!(error instanceof AnalyzerResolutionError) && !(error instanceof AnalyzerExecutionError)) {
          await captureException(error, {
            area: 'discovery',
            context: { route: '/api/analyzer/stream' },
            fingerprint: ['analyzer', 'stream'],
          });
        }
        send('error', {
          error: message,
          logs: error instanceof AnalyzerResolutionError || error instanceof AnalyzerExecutionError ? error.logs : undefined,
        });
      }).finally(() => {
        send('done', { ok: true });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
