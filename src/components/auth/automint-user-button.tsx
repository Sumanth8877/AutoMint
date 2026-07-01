'use client';

import { useEffect, useRef, useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { LogOut } from 'lucide-react';

function initials(name: string | null | undefined, email: string | null | undefined) {
  const source = name || email || 'User';
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function AutoMintUserButton() {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;
  const displayName = user?.fullName || email || 'Account';

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-primary/30 bg-primary/15 text-xs font-semibold text-text"
        aria-label="Open account menu"
        aria-expanded={open}
      >
        {user?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initials(user?.fullName, email)
        )}
      </button>

      {open ? (
        <div className="absolute left-0 bottom-10 z-50 w-64 overflow-hidden rounded-xl border border-border-strong bg-elevated shadow-[0_-12px_48px_rgba(0,0,0,0.65)]">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-semibold text-text">{displayName}</p>
            {email ? <p className="mt-1 truncate text-xs text-muted">{email}</p> : null}
          </div>
          <a
            href="/settings/profile"
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-muted hover:bg-white/5 hover:text-text transition-colors"
            onClick={() => setOpen(false)}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </a>
          <div className="h-px bg-border mx-3" />
          <button
            type="button"
            onClick={() => void signOut({ redirectUrl: '/' })}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-danger/80 hover:bg-danger/5 hover:text-danger transition-colors"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
