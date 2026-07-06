'use client';

import { useEventStream } from '@/hooks/use-event-stream';

/**
 * Thin client component that activates the SSE event stream.
 * Drop inside QueryClientProviderWrapper so it can access the query client.
 * Renders children transparently — no extra DOM nodes.
 */
export function EventStreamProvider({ children }: { children: React.ReactNode }) {
  useEventStream();
  return <>{children}</>;
}
