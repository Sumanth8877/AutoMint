import Link from 'next/link';
import { ArrowLeft, SearchX } from 'lucide-react';
import Card from '@/components/ui/Card';

export default function NotFound() {
  return (
    <main className="automint-shell flex min-h-screen items-center justify-center p-4">
      <Card tone="elevated" className="w-full max-w-lg p-8 text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
          <SearchX className="h-7 w-7" aria-hidden="true" />
        </div>
        <p className="mb-2 font-mono text-sm text-muted">404</p>
        <h1 className="text-3xl font-semibold text-text">Page not found</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white shadow-lg shadow-primary/20 transition hover:bg-primary-hover"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Home
        </Link>
      </Card>
    </main>
  );
}
