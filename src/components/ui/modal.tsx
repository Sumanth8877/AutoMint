'use client';

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

type ModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
};

export function Modal({ open, title, children, onClose }: ModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="automint-modal-title">
      <button
        type="button"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fadeIn"
        onClick={onClose}
        aria-label="Close modal"
      />
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-elevated shadow-xl ring-highlight"
        style={{ animation: 'am-fade-in-up-sm 0.18s ease-out' }}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="automint-modal-title" className="text-base font-semibold text-text">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-text"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
