'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Drawer
 *
 * A right-edge sliding side panel (as opposed to `Modal`, which is a centered
 * dialog). Same open/onClose/title/children contract as Modal so it's a
 * drop-in swap wherever a side-panel feel fits better than a centered dialog
 * (e.g. a settings/config form triggered from a small inline button).
 */
export function Drawer({ open, onClose, title, subtitle, children }: DrawerProps) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const panelInitial = reduce ? { opacity: 0 } : { opacity: 0, x: 24 };
  const panelShow = reduce ? { opacity: 1 } : { opacity: 1, x: 0 };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
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
            className="relative z-10 flex h-full w-full max-w-md flex-col overflow-hidden border-l border-border bg-surface shadow-xl"
            initial={panelInitial}
            animate={panelShow}
            exit={panelInitial}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 pt-5 pb-4">
              <div>
                <h2 className="text-base font-bold tracking-tight text-text">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-text hover:bg-surface-hover transition-colors -mt-0.5 -mr-1"
                aria-label="Close panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
