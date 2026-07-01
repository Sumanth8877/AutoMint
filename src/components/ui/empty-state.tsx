import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
      {Icon && (
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface">
          <Icon className="h-7 w-7 text-muted" aria-hidden="true" />
        </div>
      )}
      <div>
        <p className="text-base font-bold text-text">{title}</p>
        {description && <p className="mt-1.5 text-sm text-muted max-w-xs mx-auto">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
