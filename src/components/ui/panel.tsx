'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { springs } from '@/components/motion';

interface PanelProps {
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Panel
 *
 * The bare card portion of a dialog (header + close button + body), with no
 * backdrop or fixed positioning of its own. Used when two panels need to be
 * shown side by side under a single shared backdrop (e.g. "Add Tracked
 * Wallet" + "Set Mint Rule" opened together) — each panel is the same size
 * and visual style as `Modal`, but the parent controls layout/backdrop.
 */
export function Panel({ onClose, title, subtitle, children }: PanelProps) {
  const reduce = useReducedMotion();
  const panelInitial = reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 };
  const panelShow = reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 };

  return (
    <motion.div
      className="relative z-10 flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
      initial={panelInitial}
      animate={panelShow}
      exit={panelInitial}
      transition={springs.soft}
    >
      <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" />
      <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
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
      <div className="overflow-y-auto px-6 pb-6">{children}</div>
    </motion.div>
  );
}
