'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

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
  default: 'border-border-strong',
  neon:    'border-neon/30',
  gold:    'border-gold/30',
  danger:  'border-danger/30',
};

export function Modal({ open, onClose, title, subtitle, children, size = 'md', tone = 'default' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        className={`relative z-10 w-full ${sizes[size]} rounded-2xl border ${toneMap[tone]} bg-elevated shadow-[0_24px_80px_rgba(0,0,0,0.70)] overflow-hidden`}
        style={tone === 'neon' ? { boxShadow: '0 24px 80px rgba(0,0,0,0.70), 0 0 40px rgba(0,245,255,0.08)' } : undefined}
      >
        {/* Top accent line */}
        <div className={`h-px w-full ${
          tone === 'neon' ? 'bg-gradient-to-r from-transparent via-neon/60 to-transparent' :
          tone === 'gold' ? 'bg-gradient-to-r from-transparent via-gold/60 to-transparent' :
          tone === 'danger' ? 'bg-gradient-to-r from-transparent via-danger/60 to-transparent' :
          'bg-gradient-to-r from-transparent via-border-strong to-transparent'
        }`} />
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h2 className="text-base font-black tracking-tight text-text">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors -mt-0.5 -mr-1"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Body */}
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
