import Card from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AuthenticatedLoading() {
  return (
    <div className="space-y-6" aria-label="Loading page">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Card key={item} className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-5 h-8 w-20" />
            <Skeleton className="mt-3 h-3 w-36" />
          </Card>
        ))}
      </div>
      <Card tone="elevated" className="p-5">
        <Skeleton className="h-5 w-44" />
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-28" />
          ))}
        </div>
      </Card>
    </div>
  );
}
