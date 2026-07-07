'use client';

import { useEventStream } from '@/hooks/use-event-stream';
import { TelegramActivityToast } from '@/components/ui/telegram-activity-toast';

/**
 * Activates the SSE event stream and renders the Telegram AI activity overlay.
 * Drop inside QueryClientProviderWrapper so it can access the query client.
 * Renders children transparently — the only extra DOM is the toast portal.
 */
export function EventStreamProvider({ children }: { children: React.ReactNode }) {
  const { telegramEvent } = useEventStream();

  return (
    <>
      {children}
      <TelegramActivityToast event={telegramEvent} />
    </>
  );
}
