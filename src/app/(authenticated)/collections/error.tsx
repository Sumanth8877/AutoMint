'use client';

import { PageError } from '@/components/ui/page-error';

export default function CollectionsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      title="Collections failed to load"
      description="Your collections couldn't be fetched right now. Try again in a moment."
      reset={reset}
    />
  );
}
