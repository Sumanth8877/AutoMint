import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: 'default' | 'elevated' | 'interactive' | 'neon' | 'gold' | 'glass';
}

export default function Card({ children, className = '', tone = 'default', ...props }: CardProps) {
  const tones: Record<string, string> = {
    default:     'card-base',
    elevated:    'card-elevated',
    interactive: 'card-base transition-all duration-200 hover:border-border-strong hover:shadow-md cursor-pointer',
    neon:        'card-neon',
    gold:        'card-gold',
    glass:       'bg-surface-hover0 border border-border backdrop-blur-sm',
  };
  return (
    <div className={`rounded-xl ${tones[tone]} ${className}`} {...props}>
      {children}
    </div>
  );
}
