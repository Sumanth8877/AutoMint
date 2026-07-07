'use client';

import { PageError } from '@/components/ui/page-error';

export default function WlTrackerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      title="WL Tracker failed to load"
      description="We couldn't load your tracked projects this time. Try again in a moment."
      reset={reset}
    />
  );
}
