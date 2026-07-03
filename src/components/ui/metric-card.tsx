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

const toneMap: Record<string, { text: string; bg: string; border: string; glow: string }> = {
  primary: { text: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/25', glow: '0 0 20px rgba(0,255,136,0.25)' },
  neon:    { text: 'text-neon',    bg: 'bg-neon/10',    border: 'border-neon/20',    glow: '0 0 20px rgba(0,255,136,0.25)' },
  gold:    { text: 'text-gold',    bg: 'bg-gold/10',    border: 'border-gold/20',    glow: '0 0 20px rgba(240,169,59,0.25)' },
  success: { text: 'text-success', bg: 'bg-success/10', border: 'border-success/20', glow: '0 0 20px rgba(0,255,136,0.20)' },
  warning: { text: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20', glow: '0 0 20px rgba(240,169,59,0.20)' },
  danger:  { text: 'text-danger',  bg: 'bg-danger/10',  border: 'border-danger/20',  glow: '0 0 20px rgba(255,77,77,0.20)' },
  muted:   { text: 'text-muted',   bg: 'bg-white/5',    border: 'border-border',      glow: 'none' },
  accent:  { text: 'text-neon',    bg: 'bg-neon/10',    border: 'border-neon/20',    glow: '0 0 20px rgba(0,255,136,0.25)' },
};

export function MetricCard({ label, value, detail, change, changeDir = 'neutral', icon: Icon, tone = 'primary' }: MetricCardProps) {
  const t = toneMap[tone];
  const changeColor = changeDir === 'up' ? 'text-success' : changeDir === 'down' ? 'text-danger' : 'text-muted';
  const changePrefix = changeDir === 'up' ? '↑' : changeDir === 'down' ? '↓' : '';

  return (
    <HoverLift className="h-full">
      <Card tone="neon" className="group h-full p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted mb-2">{label}</p>
            <p className="stat-value text-3xl font-black tracking-tight text-text">{value}</p>
            <div className="mt-1.5 flex items-center gap-2">
              {detail && <p className="text-xs text-muted truncate">{detail}</p>}
              {change && (
                <span className={`text-xs font-semibold ${changeColor}`}>{changePrefix}{change}</span>
              )}
            </div>
          </div>
          {Icon && (
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border ${t.bg} ${t.border} ${t.text} transition-transform duration-300 group-hover:scale-110`}
              style={{ boxShadow: t.glow }}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
        </div>
      </Card>
    </HoverLift>
  );
}
