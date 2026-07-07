'use client';

import { useEventStream } from '@/hooks/use-event-stream';
import { TelegramActivityToast } from '@/components/ui/telegram-activity-toast';

/**
 * Activates the SSE event stream and renders the Telegram AI activity overlay.
 * The web AI chat panel has been removed — AI interactions happen via Telegram only.
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
