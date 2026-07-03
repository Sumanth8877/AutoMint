import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { FadeIn, PopIn } from '@/components/motion';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  description?: string;
  icon?: LucideIcon;
  iconTone?: 'neon' | 'gold' | 'purple' | 'danger' | 'success';
  actions?: ReactNode;
  badge?: ReactNode;
}

const iconToneMap: Record<string, { bg: string; text: string; border: string; glow: string }> = {
  neon:    { bg: 'bg-neon/10',    text: 'text-neon',    border: 'border-neon/25',    glow: '0 0 20px rgba(0,255,136,0.30)' },
  gold:    { bg: 'bg-gold/10',    text: 'text-gold',    border: 'border-gold/25',    glow: '0 0 20px rgba(240,169,59,0.30)' },
  purple:  { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/25', glow: '0 0 20px rgba(0,255,136,0.30)' },
  danger:  { bg: 'bg-danger/10',  text: 'text-danger',  border: 'border-danger/25',  glow: '0 0 20px rgba(255,77,77,0.30)' },
  success: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/25', glow: '0 0 20px rgba(0,255,136,0.30)' },
};

// NOTE: this is a Server Component on purpose. It's rendered from every
// page.tsx (all Server Components) with `icon={SomeLucideIcon}` — a raw
// component reference. React Server Components cannot pass function/
// component-reference props into a Client Component ("Functions cannot be
// passed directly to Client Components..."), so this component itself must
// stay server-rendered. The icon is rendered here (server-side) into a real
// element and handed to <PopIn> as `children`, which IS allowed — only the
// small, purely-visual PopIn/FadeIn wrappers (from @/components/motion) are
// Client Components, and they only ever receive already-rendered children
// and plain serializable props (strings/numbers/style objects).
export function PageHeader({ title, subtitle, eyebrow, description, icon: Icon, iconTone = 'neon', actions, badge }: PageHeaderProps) {
  const t = iconToneMap[iconTone];

  return (
    <FadeIn className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        {Icon && (
          <PopIn
            className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${t.bg} ${t.text} ${t.border}`}
            style={{ boxShadow: t.glow }}
            rotate={12}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </PopIn>
        )}
        <div>
          {eyebrow && <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{eyebrow}</p>}
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-text">{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          {description && <p className="mt-1 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </FadeIn>
  );
}
