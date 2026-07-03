'use client';

import { PageError } from '@/components/ui/page-error';

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      title="Dashboard failed to load"
      description="Your mission control had a hiccup. Try refreshing to bring it back online."
      reset={reset}
    />
  );
}
