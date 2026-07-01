import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: 'default' | 'elevated' | 'interactive' | 'neon' | 'gold' | 'glass';
}

export default function Card({ children, className = '', tone = 'default', ...props }: CardProps) {
  const tones: Record<string, string> = {
    default:     'card-base',
    elevated:    'card-elevated',
    interactive: 'card-base transition-all duration-200 hover:border-border-strong hover:bg-surface-hover hover:shadow-md cursor-pointer',
    neon:        'card-neon',
    gold:        'card-gold',
    glass:       'bg-white/[0.03] border border-white/[0.06] backdrop-blur-md',
  };
  return (
    <div className={`rounded-2xl ${tones[tone]} ${className}`} {...props}>
      {children}
    </div>
  );
}
