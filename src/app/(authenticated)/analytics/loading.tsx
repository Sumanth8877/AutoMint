import Card from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AnalyticsLoading() {
  return (
    <div>
      <div className="mb-6">
        <Skeleton className="h-4 w-24 bg-white/5" />
        <Skeleton className="mt-3 h-9 w-56 bg-white/5" />
        <Skeleton className="mt-3 h-5 w-full max-w-xl bg-white/5" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="p-5">
            <Skeleton className="h-3 w-28 bg-white/5" />
            <Skeleton className="mt-4 h-8 w-20 bg-white/5" />
            <Skeleton className="mt-3 h-3 w-32 bg-white/5" />
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="p-5">
            <Skeleton className="h-6 w-48 bg-white/5" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-24 bg-white/5" />
              <Skeleton className="h-24 bg-white/5" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
