import Image from 'next/image';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: LucideIcon;
  image?: string;
  imageAlt?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, image, imageAlt = '', title, description, action }: EmptyStateProps) {
  const hasImage = Boolean(image);

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-14 text-center sm:py-16">
      {hasImage ? (
        <div className="relative aspect-[16/9] w-full max-w-md overflow-hidden rounded-2xl border border-border bg-white">
          <Image
            src={image!}
            alt={imageAlt}
            fill
            sizes="(min-width: 640px) 28rem, 90vw"
            className="object-contain p-3"
          />
        </div>
      ) : (
        Icon && (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface shadow-sm">
            <Icon className="h-7 w-7 text-muted" aria-hidden="true" />
          </div>
        )
      )}
      <div>
        <p className="text-base font-semibold text-text sm:text-lg">{title}</p>
        {description && <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
