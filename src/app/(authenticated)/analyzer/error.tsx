'use client';

import { PageError } from '@/components/ui/page-error';

export default function AnalyzerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageError
      title="Analyzer failed to load"
      description="The analyzer hit an unexpected snag. Give it another go."
      reset={reset}
    />
  );
}
