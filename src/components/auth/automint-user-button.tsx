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
        <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-semibold text-text">{displayName}</p>
            {email ? <p className="mt-1 truncate text-xs text-muted">{email}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => void signOut({ redirectUrl: '/' })}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-muted hover:bg-white/5 hover:text-text"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
