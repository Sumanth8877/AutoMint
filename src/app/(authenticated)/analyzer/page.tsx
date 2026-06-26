import { Suspense } from 'react';
import AnalyzerClient from './analyzer-client';
import { Skeleton } from '@/components/ui/skeleton';

// Cache this page for 30 seconds (has dynamic searchParams)
export const revalidate = 30;

export default async function AnalyzerPage({
  searchParams,
}: {
  searchParams: Promise<{ input?: string }>;
}) {
  const params = await searchParams;
  return (
    <Suspense fallback={<div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}>
      <AnalyzerClient initialInput={params.input ?? ''} />
    </Suspense>
  );
}
