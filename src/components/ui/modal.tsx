'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { springs } from '@/components/motion';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'default' | 'neon' | 'gold' | 'danger';
}

const sizes = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

const toneMap: Record<string, string> = {
  default: 'border-border',
  neon:    'border-primary/20',
  gold:    'border-gold/20',
  danger:  'border-danger/20',
};

export function Modal({ open, onClose, title, subtitle, children, size = 'md', tone = 'default' }: ModalProps) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const panelInitial = reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 };
  const panelShow = reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
          {/* Panel */}
          <motion.div
            className={`relative z-10 w-full ${sizes[size]} rounded-xl border ${toneMap[tone]} bg-surface shadow-lg overflow-hidden`}
            initial={panelInitial}
            animate={panelShow}
            exit={panelInitial}
            transition={springs.soft}
          >
            {/* Top accent line */}
            <div className={`h-px w-full ${
              tone === 'neon' ? 'bg-gradient-to-r from-transparent via-primary/40 to-transparent' :
              tone === 'gold' ? 'bg-gradient-to-r from-transparent via-gold/40 to-transparent' :
              tone === 'danger' ? 'bg-gradient-to-r from-transparent via-danger/40 to-transparent' :
              'bg-gradient-to-r from-transparent via-border to-transparent'
            }`} />
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
              <div>
                <h2 className="text-base font-bold tracking-tight text-text">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-text hover:bg-surface-hover transition-colors -mt-0.5 -mr-1"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Body */}
            <div className="px-6 pb-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
