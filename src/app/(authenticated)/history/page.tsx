import { Suspense } from 'react';
import HistoryClient from './history-client';
import { Skeleton } from '@/components/ui/skeleton';

// Always fetch fresh — analyzer results must appear immediately
export const revalidate = 0;

export default function HistoryPage() {
  return (
    <Suspense fallback={<div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}>
      <HistoryClient />
    </Suspense>
  );
}
