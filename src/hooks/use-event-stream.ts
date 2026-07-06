'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// ── useEventStream ───────────────────────────────────────────────────────────
// Opens an SSE connection to /api/events/stream. When the server sends an
// "invalidate" frame, we invalidate the matching React Query keys so the UI
// refetches fresh data automatically.
//
// Reconnects automatically on disconnect (EventSource built-in + our 3s delay).

interface InvalidateEvent {
  type: string;
  queryKeys: string[];
  meta?: Record<string, unknown>;
  ts: number;
}

export function useEventStream() {
  const queryClient = useQueryClient();
  const retryDelay = useRef(1500);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    function connect() {
      if (closed) return;

      es = new EventSource('/api/events/stream');

      es.addEventListener('invalidate', (e: MessageEvent) => {
        try {
          const data: InvalidateEvent = JSON.parse(e.data);

          // Invalidate each query key so React Query refetches
          for (const key of data.queryKeys) {
            void queryClient.invalidateQueries({ queryKey: [key] });
          }

          // Reset retry delay on successful data
          retryDelay.current = 1500;
        } catch {
          // ignore malformed events
        }
      });

      es.addEventListener('reconnect', () => {
        // Server asked us to reconnect (hit max duration)
        es?.close();
        setTimeout(connect, 500);
      });

      es.addEventListener('heartbeat', () => {
        // Keep-alive — reset retry delay
        retryDelay.current = 1500;
      });

      es.onerror = () => {
        es?.close();
        // Exponential backoff capped at 15s
        const delay = retryDelay.current;
        retryDelay.current = Math.min(delay * 1.5, 15000);
        setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      closed = true;
      es?.close();
    };
  }, [queryClient]);
}
