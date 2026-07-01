import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'neon' | 'gold' | 'purple' | 'info';
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}

const variantMap = {
  default: { bg: 'bg-white/[0.06]', text: 'text-secondary', border: 'border-border', dot: 'bg-secondary' },
  success: { bg: 'bg-success/10', text: 'text-success', border: 'border-success/25', dot: 'bg-success shadow-[0_0_6px_rgba(16,185,129,0.8)]' },
  warning: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/25', dot: 'bg-warning shadow-[0_0_6px_rgba(245,158,11,0.8)]' },
  danger:  { bg: 'bg-danger/10',  text: 'text-danger',  border: 'border-danger/25',  dot: 'bg-danger shadow-[0_0_6px_rgba(239,68,68,0.8)]' },
  neon:    { bg: 'bg-neon/[0.08]', text: 'text-neon',   border: 'border-neon/20',    dot: 'bg-neon shadow-[0_0_6px_rgba(0,245,255,0.8)]' },
  gold:    { bg: 'bg-gold/[0.08]', text: 'text-gold',   border: 'border-gold/20',    dot: 'bg-gold shadow-[0_0_6px_rgba(245,158,11,0.8)]' },
  purple:  { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/25', dot: 'bg-primary shadow-[0_0_6px_rgba(124,58,237,0.8)]' },
  info:    { bg: 'bg-info/[0.08]',  text: 'text-info',    border: 'border-info/20',    dot: 'bg-info shadow-[0_0_6px_rgba(59,130,246,0.8)]' },
};

export default function Badge({ children, variant = 'default', dot = false, pulse = false, className = '' }: BadgeProps) {
  const v = variantMap[variant];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${v.bg} ${v.text} ${v.border} ${className}`}>
      {dot && (
        <span className={`h-1.5 w-1.5 rounded-full ${v.dot} ${pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}
