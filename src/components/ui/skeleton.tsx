interface SkeletonProps {
  className?: string;
  lines?: number;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 3 }: SkeletonProps) {
  return (
    <div className="card-base rounded-2xl p-5 space-y-3">
      <Skeleton className="h-5 w-2/5" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-3/5' : 'w-full'}`} />
      ))}
    </div>
  );
}
