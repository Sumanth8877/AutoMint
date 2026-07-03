'use client';

import { PageError } from '@/components/ui/page-error';

export default function HistoryError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      title="History failed to load"
      description="AutoMint couldn't fetch your mint history. Try again in a moment."
      reset={reset}
    />
  );
}
