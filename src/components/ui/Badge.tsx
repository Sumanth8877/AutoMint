import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  dot?: boolean;
  className?: string;
}

const dotColors = {
  default: 'bg-muted',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-accent',
};

export default function Badge({ children, variant = 'default', dot = false, className = '' }: BadgeProps) {
  const variants = {
    default: 'bg-white/[0.06] text-secondary border-border',
    success: 'bg-success/10 text-success border-success/25',
    warning: 'bg-warning/10 text-warning border-warning/25',
    danger: 'bg-danger/10 text-danger border-danger/25',
    info: 'bg-accent/10 text-accent border-accent/25',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${variants[variant]} ${className}`}
    >
      {dot ? <span className={`h-1.5 w-1.5 rounded-full ${dotColors[variant]}`} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
