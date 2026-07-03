'use client';

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { EASE_OUT, springs } from '@/components/motion';

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
  neon:    { bg: 'bg-neon/10',    text: 'text-neon',    border: 'border-neon/25',    glow: '0 0 20px rgba(0,245,255,0.30)' },
  gold:    { bg: 'bg-gold/10',    text: 'text-gold',    border: 'border-gold/25',    glow: '0 0 20px rgba(245,158,11,0.30)' },
  purple:  { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/25', glow: '0 0 20px rgba(124,58,237,0.30)' },
  danger:  { bg: 'bg-danger/10',  text: 'text-danger',  border: 'border-danger/25',  glow: '0 0 20px rgba(239,68,68,0.30)' },
  success: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/25', glow: '0 0 20px rgba(16,185,129,0.30)' },
};

export function PageHeader({ title, subtitle, eyebrow, description, icon: Icon, iconTone = 'neon', actions, badge }: PageHeaderProps) {
  const t = iconToneMap[iconTone];
  const reduce = useReducedMotion();

  return (
    <motion.div
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT }}
    >
      <div className="flex items-center gap-4">
        {Icon && (
          <motion.div
            className={`flex h-12 w-12 items-center justify-center rounded-2xl border ${t.bg} ${t.text} ${t.border}`}
            style={{ boxShadow: t.glow }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, rotate: -12 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={springs.gentle}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </motion.div>
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
    </motion.div>
  );
}
