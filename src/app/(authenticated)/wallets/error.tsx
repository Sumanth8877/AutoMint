'use client';

import { PageError } from '@/components/ui/page-error';

export default function WalletsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      title="Wallets failed to load"
      description="Your wallets couldn't be reached this time. Try again in a moment."
      reset={reset}
    />
  );
}
