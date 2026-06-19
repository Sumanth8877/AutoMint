import type { ReactNode } from 'react';

interface PanelProps {
  children: ReactNode;
  className?: string;
}

export default function Panel({ children, className = '' }: PanelProps) {
  return (
    <div className={`rounded-lg border border-border bg-surface/80 ${className}`}>
      {children}
    </div>
  );
}
