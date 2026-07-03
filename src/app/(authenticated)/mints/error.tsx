'use client';

import { PageError } from '@/components/ui/page-error';

export default function MintsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      title="Mints failed to load"
      description="AutoMint could not load your mint tasks right now. Try again in a moment."
      reset={reset}
    />
  );
}
