import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: 'default' | 'elevated' | 'interactive';
}

export default function Card({ children, className = '', tone = 'default', ...props }: CardProps) {
  const tones = {
    default: 'bg-surface/80 border-border',
    elevated: 'premium-card',
    interactive: 'bg-surface/80 border-border hover:border-white/16 hover:bg-elevated/90 transition-colors',
  };

  return (
    <div
      className={`rounded-lg border ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
