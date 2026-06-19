import type { LucideIcon } from 'lucide-react';
import Card from './Card';

interface MetricCardProps {
  label: string;
  value: string | number;
  detail?: string;
  icon?: LucideIcon;
  tone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'muted';
}

const toneClasses = {
  primary: 'text-primary bg-primary/10 border-primary/20',
  accent: 'text-accent bg-accent/10 border-accent/20',
  success: 'text-success bg-success/10 border-success/20',
  warning: 'text-warning bg-warning/10 border-warning/20',
  danger: 'text-danger bg-danger/10 border-danger/20',
  muted: 'text-muted bg-white/5 border-border',
};

export function MetricCard({ label, value, detail, icon: Icon, tone = 'primary' }: MetricCardProps) {
  return (
    <Card className="p-4 sm:p-5" tone="interactive">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
          {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
        </div>
        {Icon ? (
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${toneClasses[tone]}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
