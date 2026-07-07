import { Suspense } from 'react';
import WlTrackerClient from './wl-tracker-client';
import { Skeleton } from '@/components/ui/skeleton';

// Disable cache so newly-added tracked projects appear immediately.
export const revalidate = 0;

export default function WlTrackerPage() {
  return (
    <Suspense fallback={<div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}>
      <WlTrackerClient />
    </Suspense>
  );
}
