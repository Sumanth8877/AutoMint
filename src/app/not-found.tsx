import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, LayoutDashboard } from 'lucide-react';
import Card from '@/components/ui/Card';

export default function NotFound() {
  return (
    <main className="automint-shell flex min-h-screen items-center justify-center p-4">
      <Card tone="elevated" className="w-full max-w-2xl p-6 text-center sm:p-10">
        <div className="relative mx-auto aspect-[16/9] w-full max-w-lg overflow-hidden rounded-xl bg-white ring-1 ring-border/60">
          <Image
            src="/illustrations/not-found-404.jpeg"
            alt="Illustration of a small character peering into a hole where the digits 4-0-4 are falling."
            fill
            sizes="(min-width: 640px) 32rem, 90vw"
            priority
            className="object-contain p-2"
          />
        </div>

        <p className="mt-6 font-mono text-sm text-muted">404</p>
        <h1 className="mt-1 text-3xl font-semibold text-text">Page not found</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted">
          The page you are looking for does not exist or has been moved.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium text-text transition hover:bg-surface/80"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Home
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white shadow-lg shadow-primary/20 transition hover:bg-primary-hover"
          >
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            Go to Dashboard
          </Link>
        </div>
      </Card>
    </main>
  );
}
