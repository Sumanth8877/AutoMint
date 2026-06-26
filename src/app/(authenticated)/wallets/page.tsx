import { Suspense } from 'react';
import WalletsClient from './wallets-client';
import { Skeleton } from '@/components/ui/skeleton';

// Disable cache so UI reflects mutations immediately
export const revalidate = 0;

export default function WalletsPage() {
  return (
    <Suspense fallback={<div className="space-y-3 p-6">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}>
      <WalletsClient />
    </Suspense>
  );
}
