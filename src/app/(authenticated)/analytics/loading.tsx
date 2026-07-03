import Image from 'next/image';
import Card from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/skeleton';

export default function AnalyticsLoading() {
  return (
    <div>
      <div className="mb-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_240px] md:items-center">
        <div>
          <Skeleton className="h-4 w-24 bg-surface-hover" />
          <Skeleton className="mt-3 h-9 w-56 bg-surface-hover" />
          <Skeleton className="mt-3 h-5 w-full max-w-xl bg-surface-hover" />
        </div>
        <div className="relative hidden aspect-[16/9] w-full overflow-hidden rounded-xl border border-border bg-white md:block">
          <Image
            src="/illustrations/empty-analytics.jpeg"
            alt="A small character holds two large blank chart cards, waiting for data to arrive."
            fill
            sizes="240px"
            className="object-contain p-2"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="p-5">
            <Skeleton className="h-3 w-28 bg-surface-hover" />
            <Skeleton className="mt-4 h-8 w-20 bg-surface-hover" />
            <Skeleton className="mt-3 h-3 w-32 bg-surface-hover" />
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="p-5">
            <Skeleton className="h-6 w-48 bg-surface-hover" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-24 bg-surface-hover" />
              <Skeleton className="h-24 bg-surface-hover" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
