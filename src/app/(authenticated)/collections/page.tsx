import { Suspense } from 'react';
import CollectionsClient from './collections-client';
import { Skeleton } from '@/components/ui/skeleton';

// Cache this page for 4 hours
export const revalidate = 14400;

export default function CollectionsPage() {
  return (
    <Suspense fallback={<div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}>
      <CollectionsClient />
    </Suspense>
  );
}
