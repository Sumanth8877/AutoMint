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

  // Derive the best available display name — updates reactively when
  // the user saves their profile via Settings → Profile.
  const name = user?.fullName
    || [user?.firstName, user?.lastName].filter(Boolean).join(' ')
    || email?.split('@')[0]
    || 'Account';

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-2.5 text-left transition-all duration-200 hover:border-border-strong hover:bg-surface-hover"
        aria-label="Open account menu"
        aria-expanded={open}
      >
        {/* Avatar */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-primary/30 bg-primary/15 text-xs font-bold text-text">
          {user?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(user?.fullName, email)
          )}
        </div>
        {/* Name + email */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-text">{name}</p>
          {email && <p className="truncate text-[10px] text-muted">{email}</p>}
        </div>
        {/* Chevron */}
        <svg className="h-3.5 w-3.5 shrink-0 text-muted transition-transform group-aria-expanded:rotate-180" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 bottom-10 z-50 w-64 overflow-hidden rounded-xl border border-border-strong bg-elevated shadow-[0_-12px_48px_rgba(0,0,0,0.65)]">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-semibold text-text">{displayName}</p>
            {email ? <p className="mt-1 truncate text-xs text-muted">{email}</p> : null}
          </div>
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
