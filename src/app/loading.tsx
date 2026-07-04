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
          <div className="space-y-6">
            <Skeleton className="h-6 w-40" />
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-16" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
