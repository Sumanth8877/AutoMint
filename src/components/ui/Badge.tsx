import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'neon' | 'gold' | 'purple' | 'info';
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

const variantMap = {
  default: { bg: 'bg-slate-100', text: 'text-secondary', border: 'border-border', dot: 'bg-secondary' },
  success: { bg: 'bg-emerald-50', text: 'text-success', border: 'border-success/20', dot: 'bg-success' },
  warning: { bg: 'bg-amber-50', text: 'text-warning', border: 'border-warning/20', dot: 'bg-warning' },
  danger:  { bg: 'bg-red-50',  text: 'text-danger',  border: 'border-danger/20',  dot: 'bg-danger' },
  neon:    { bg: 'bg-indigo-50', text: 'text-primary', border: 'border-primary/20', dot: 'bg-primary' },
  gold:    { bg: 'bg-amber-50', text: 'text-gold',   border: 'border-gold/20',    dot: 'bg-gold' },
  purple:  { bg: 'bg-indigo-50', text: 'text-primary', border: 'border-primary/20', dot: 'bg-primary' },
  info:    { bg: 'bg-slate-100', text: 'text-info',    border: 'border-slate-200',    dot: 'bg-info' },
};

export default function Badge({ children, variant = 'default', dot = false, pulse = false, className = '' }: BadgeProps) {
  const v = variantMap[variant];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-tight ${v.bg} ${v.text} ${v.border} ${className}`}>
      {dot && (
        <span className={`h-1.5 w-1.5 rounded-full ${v.dot} ${pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
