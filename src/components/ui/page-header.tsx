import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconTone?: 'neon' | 'gold' | 'purple' | 'danger' | 'success';
  actions?: ReactNode;
  badge?: ReactNode;
}

const iconToneMap: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  neon:    { bg: 'bg-neon/10',    text: 'text-neon',    border: 'border-neon/25',    glow: '0 0 20px rgba(0,245,255,0.30)' },
  gold:    { bg: 'bg-gold/10',    text: 'text-gold',    border: 'border-gold/25',    glow: '0 0 20px rgba(245,158,11,0.30)' },
  purple:  { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/25', glow: '0 0 20px rgba(124,58,237,0.30)' },
  danger:  { bg: 'bg-danger/10',  text: 'text-danger',  border: 'border-danger/25',  glow: '0 0 20px rgba(239,68,68,0.30)' },
  success: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/25', glow: '0 0 20px rgba(16,185,129,0.30)' },
};

export function PageHeader({ title, subtitle, icon: Icon, iconTone = 'neon', actions, badge }: PageHeaderProps) {
  const t = iconToneMap[iconTone];
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        {Icon && (
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${t.bg} ${t.text} ${t.border}`}
            style={{ boxShadow: t.glow }}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-text">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
