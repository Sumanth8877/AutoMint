import Image from 'next/image';
import Card from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/skeleton';

export default function RootLoading() {
  return (
    <main className="automint-shell min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-[1280px] space-y-8">
        <Skeleton className="h-10 w-44" />
        <div className="grid min-h-[70vh] items-center gap-10 lg:grid-cols-2">
          <div className="space-y-5">
            <Skeleton className="h-5 w-96 max-w-full" />
            <Skeleton className="h-20 w-full max-w-2xl" />
            <Skeleton className="h-6 w-full max-w-xl" />
            <Skeleton className="h-12 w-72" />
          </div>
          <Card tone="elevated" className="p-6">
            <div className="relative mx-auto aspect-[16/9] w-full max-w-md overflow-hidden rounded-xl bg-white ring-1 ring-border/60">
              <Image
                src="/illustrations/loading-crank.jpeg"
                alt="A small character patiently cranking an old data-pump machine while pipes puff data upward."
                fill
                sizes="(min-width: 1024px) 28rem, 90vw"
                priority
                className="object-contain p-2"
              />
            </div>
            <Skeleton className="mt-6 h-6 w-40" />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-16" />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
