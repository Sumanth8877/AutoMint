'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

export default function AnalyzerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-danger/20 bg-red-50 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-text">Analyzer failed to load</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
        AutoMint could not load the analyzer right now.
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
