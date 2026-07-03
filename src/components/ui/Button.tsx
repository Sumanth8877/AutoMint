'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { springs } from '@/components/motion';

// framer-motion redefines a few DOM handlers, so omit them to avoid type clashes.
type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onAnimationStart' | 'onAnimationEnd' | 'onDragStart' | 'onDragEnd' | 'onDrag'
>;

interface ButtonProps extends NativeButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'neon' | 'gold';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
  glow?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  glow = false,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const reduce = useReducedMotion();
  const base =
    'inline-flex shrink-0 items-center justify-center font-semibold rounded-lg transition-colors duration-200 ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-neon/50 focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-background tracking-normal will-change-transform';

  const variants: Record<string, string> = {
    primary:
      'bg-gradient-to-r from-primary to-purple-500 text-white shadow-lg shadow-primary/30 ' +
      'hover:shadow-primary/50 hover:brightness-110 border border-primary/40',
    secondary:
      'bg-surface text-text border border-border hover:border-border-strong hover:bg-elevated',
    ghost: 'bg-transparent text-secondary hover:text-text hover:bg-white/5',
    danger:
      'bg-gradient-to-r from-danger to-red-600 text-white shadow-md shadow-danger/25 hover:brightness-110',
    success:
      'bg-gradient-to-r from-success to-emerald-500 text-white shadow-md shadow-success/25 hover:brightness-110',
    neon:
      'bg-neon-soft text-neon border border-neon/30 hover:bg-neon/20 hover:border-neon/60 ' +
      'shadow-[0_0_20px_rgba(0,245,255,0.15)] hover:shadow-[0_0_30px_rgba(0,245,255,0.30)]',
    gold:
      'bg-gold-soft text-gold border border-gold/30 hover:bg-gold/15 hover:border-gold/60 ' +
      'shadow-[0_0_20px_rgba(245,158,11,0.15)] hover:shadow-[0_0_30px_rgba(245,158,11,0.30)]',
  };

  const sizes: Record<string, string> = {
    xs: 'h-7 px-2.5 text-xs gap-1',
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-11 px-5 text-sm gap-2.5',
    xl: 'h-13 px-7 text-base gap-3',
  };

  const glowStyle = glow && variant === 'neon'
    ? { boxShadow: '0 0 30px rgba(0,245,255,0.40), 0 0 8px rgba(0,245,255,0.60)' }
    : glow && variant === 'primary'
    ? { boxShadow: '0 0 30px rgba(124,58,237,0.50), 0 0 8px rgba(124,58,237,0.70)' }
    : undefined;

  const isDisabled = disabled || loading;

  return (
    <motion.button
      className={`${base} ${variants[variant]} ${sizes[size]} ${
        isDisabled ? 'cursor-not-allowed opacity-50' : ''
      } ${className}`}
      style={glowStyle}
      disabled={isDisabled}
      whileHover={reduce || isDisabled ? undefined : { scale: 1.02 }}
      whileTap={reduce || isDisabled ? undefined : { scale: 0.96 }}
      transition={springs.snappy}
      {...props}
    >
      {loading && (
        <svg className="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </motion.button>
  );
}
