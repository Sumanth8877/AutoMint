import type { LucideIcon } from 'lucide-react';
import Card from './Card';
import { HoverLift } from '@/components/motion';

// NOTE: this must stay a Server Component. It's rendered from page.tsx
// files (Server Components) with `icon={SomeLucideIcon}` — a raw component
// reference — and React cannot pass a function/component reference as a
// prop into a Client Component ("Functions cannot be passed directly to
// Client Components..."). <HoverLift> (from @/components/motion) is a
// Client Component, but it's only ever given already-rendered `children`
// and a plain string `className` here, which is safe.

interface MetricCardProps {
  label: string;
  value: string | number;
  detail?: string;
  change?: string;
  changeDir?: 'up' | 'down' | 'neutral';
  icon?: LucideIcon;
  tone?: 'primary' | 'neon' | 'gold' | 'success' | 'warning' | 'danger' | 'muted' | 'accent';
}

const toneMap: Record<string, { text: string; bg: string; border: string }> = {
  primary: { text: 'text-primary', bg: 'bg-indigo-50', border: 'border-primary/15' },
  neon:    { text: 'text-primary', bg: 'bg-indigo-50', border: 'border-primary/15' },
  gold:    { text: 'text-gold',    bg: 'bg-amber-50',  border: 'border-gold/15' },
  success: { text: 'text-success', bg: 'bg-emerald-50',border: 'border-success/15' },
  warning: { text: 'text-warning', bg: 'bg-amber-50',  border: 'border-warning/15' },
  danger:  { text: 'text-danger',  bg: 'bg-red-50',    border: 'border-danger/15' },
  muted:   { text: 'text-muted',   bg: 'bg-slate-100', border: 'border-border' },
  accent:  { text: 'text-primary', bg: 'bg-indigo-50', border: 'border-primary/15' },
};

export function MetricCard({ label, value, detail, change, changeDir = 'neutral', icon: Icon, tone = 'primary' }: MetricCardProps) {
  const t = toneMap[tone];
  const changeColor = changeDir === 'up' ? 'text-success' : changeDir === 'down' ? 'text-danger' : 'text-muted';
  const changePrefix = changeDir === 'up' ? '↑' : changeDir === 'down' ? '↓' : '';

  return (
    <HoverLift className="h-full">
      <Card tone="default" className="group h-full p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-2">{label}</p>
            <p className="stat-value text-2xl font-bold tracking-tight text-text">{value}</p>
            <div className="mt-1.5 flex items-center gap-2">
              {detail && <p className="text-xs text-muted truncate">{detail}</p>}
              {change && (
                <span className={`text-xs font-semibold ${changeColor}`}>{changePrefix}{change}</span>
              )}
            </div>
          </div>
          {Icon && (
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${t.bg} ${t.border} ${t.text} transition-transform duration-200 group-hover:scale-105`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>
      </Card>
    </HoverLift>
  );
}
