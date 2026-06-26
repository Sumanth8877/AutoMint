'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

export default function MintsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-danger/20 bg-danger/10 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-text">Mints failed to load</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
        AutoMint could not load your mint tasks right now.
      </p>
      <div className="mt-5 flex justify-center">
        <Button onClick={reset}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </Card>
  );
}
