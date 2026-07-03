'use client';

import Image from 'next/image';
import { RefreshCw } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

interface PageErrorProps {
  title?: string;
  description?: string;
  reset: () => void;
}

export function PageError({
  title = 'Something went sideways',
  description = 'AutoMint hit an unexpected error. Give it another go while we patch things up.',
  reset,
}: PageErrorProps) {
  return (
    <Card className="p-6 sm:p-8 text-center">
      <div className="relative mx-auto aspect-[16/9] w-full max-w-md overflow-hidden rounded-2xl border border-border bg-white">
        <Image
          src="/illustrations/error-500.jpeg"
          alt="A small character with a wrench standing beside a smoking, half-open machine — calmly fixing it."
          fill
          sizes="(min-width: 640px) 28rem, 90vw"
          className="object-contain p-3"
          priority
        />
      </div>
      <h2 className="mt-6 text-lg font-semibold text-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{description}</p>
      <div className="mt-5 flex justify-center">
        <Button onClick={reset}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </Card>
  );
}
