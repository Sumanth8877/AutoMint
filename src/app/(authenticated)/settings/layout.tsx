'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Bell, KeyRound, User, Wrench } from 'lucide-react';

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
};

const NAV: NavItem[] = [
  { label: 'Profile', href: '/settings/profile', icon: User },
  { label: 'Notifications', href: '/settings/notifications', icon: Bell },
  { label: 'Integrations', href: '/settings/integrations', icon: KeyRound },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text sm:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted">Configure your AutoMint workspace.</p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Sidebar */}
        <nav aria-label="Settings sections" className="lg:sticky lg:top-6 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
            {NAV.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href} className="shrink-0 lg:shrink">
                  <Link
                    href={item.href}
                    prefetch
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-indigo-50 text-primary'
                        : 'text-muted hover:bg-surface-hover hover:text-text',
                    ].join(' ')}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="font-medium">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Content pane */}
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
