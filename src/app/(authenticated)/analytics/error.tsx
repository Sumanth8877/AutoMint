'use client';

import { PageError } from '@/components/ui/page-error';

export default function AnalyticsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      title="Analytics failed to load"
      description="We couldn't crunch the numbers this time. Try again in a moment."
      reset={reset}
    />
  );
}
