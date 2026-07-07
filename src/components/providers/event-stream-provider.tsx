'use client';

import { useEventStream } from '@/hooks/use-event-stream';
import { TelegramActivityToast } from '@/components/ui/telegram-activity-toast';
import { AIChat } from '@/components/ui/ai-chat';

/**
 * Activates the SSE event stream, renders the Telegram AI activity overlay,
 * and mounts the floating web AI chat panel available on every page.
 */
export function EventStreamProvider({ children }: { children: React.ReactNode }) {
  const { telegramEvent } = useEventStream();

  return (
    <>
      {children}
      <TelegramActivityToast event={telegramEvent} />
      <AIChat />
    </>
  );
}
