import type { HTMLAttributes, ReactNode } from 'react';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  label?: string;
}

export function Panel({ children, label, className = '', ...props }: PanelProps) {
  return (
    <div className={`rounded-2xl border border-border bg-surface p-5 ${className}`} {...props}>
      {label && (
        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.18em] text-muted">{label}</p>
      )}
      {children}
    </div>
  );
}
