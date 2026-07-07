import { requireApiUser } from '@/lib/auth/require-auth';
import { pollEvents, EVENT_TO_QUERY_KEYS } from '@/lib/services/event-bus.service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ── SSE endpoint ─────────────────────────────────────────────────────────────
// The browser opens a long-lived connection. We poll Redis every ~1.5s for new
// events and push them as SSE data frames. The client receives query keys to
// invalidate, keeping the UI in sync with Telegram bot actions.
//
// Vercel serverless functions have a ~25s execution limit on the hobby plan
// (300s on Pro). We cap at 55s and let the client auto-reconnect via
// EventSource's built-in retry mechanism.

const POLL_INTERVAL_MS = 1500;
const MAX_DURATION_MS = 55_000; // stay under Vercel's serverless limit

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(_req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const userId = authResult.userId;
  const encoder = new TextEncoder();
  let alive = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Send initial heartbeat so the browser knows the connection is live
      controller.enqueue(encoder.encode(sseFrame('heartbeat', { ts: Date.now() })));

      let sinceTs = Date.now();
      const startedAt = Date.now();

      const poll = async () => {
        while (alive && (Date.now() - startedAt) < MAX_DURATION_MS) {
          try {
            const events = await pollEvents(userId, sinceTs);

            for (const evt of events) {
              // Resolve which React Query keys the browser should invalidate
              const queryKeys = EVENT_TO_QUERY_KEYS[evt.type] ?? [];
              controller.enqueue(
                encoder.encode(
                  sseFrame('invalidate', {
                    type: evt.type,
                    queryKeys,
                    meta: evt.meta,
                    ts: evt.ts,
                  }),
                ),
              );
              sinceTs = Math.max(sinceTs, evt.ts);
            }
          } catch {
            // Swallow poll errors — we'll retry next tick
          }

          // Heartbeat to keep connection alive
          controller.enqueue(encoder.encode(sseFrame('heartbeat', { ts: Date.now() })));

          // Wait before next poll
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }

        // Graceful close — client will auto-reconnect
        controller.enqueue(encoder.encode(sseFrame('reconnect', { reason: 'max-duration' })));
        controller.close();
      };

      void poll();
    },
    cancel() {
      alive = false;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}
