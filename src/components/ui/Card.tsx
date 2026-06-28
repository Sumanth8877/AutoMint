import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: 'default' | 'elevated' | 'interactive';
}

export default function Card({ children, className = '', tone = 'default', ...props }: CardProps) {
  const tones = {
    default: 'card-base',
    elevated: 'premium-card ring-highlight',
    interactive:
      'card-base transition-all duration-200 hover:border-border-strong hover:bg-surface-hover hover:shadow-md',
  };

  return (
    <div className={`rounded-xl ${tones[tone]} ${className}`} {...props}>
      {children}
    </div>
  );
}
