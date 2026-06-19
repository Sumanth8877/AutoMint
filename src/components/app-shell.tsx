'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import {
  Activity,
  BarChart3,
  Bell,
  ChevronRight,
  Clock3,
  FolderKanban,
  Gauge,
  History,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  Zap,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/analyzer', label: 'Analyzer', icon: Gauge },
  { href: '/collections', label: 'Collections', icon: FolderKanban },
  { href: '/mints', label: 'Mints', icon: Zap },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/history', label: 'History', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3" aria-label="AutoMint dashboard">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/15">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold text-text">AutoMint</p>
        <p className="text-[11px] uppercase text-muted">Mint intelligence</p>
      </div>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1" aria-label="Main navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`group flex h-10 items-center justify-between rounded-lg px-3 text-sm transition-colors ${
              active
                ? 'bg-primary/14 text-text ring-1 ring-primary/25'
                : 'text-muted hover:bg-white/5 hover:text-text'
            }`}
          >
            <span className="flex items-center gap-3">
              <Icon className={`h-4 w-4 ${active ? 'text-accent' : 'text-muted group-hover:text-text'}`} aria-hidden="true" />
              {item.label}
            </span>
            {active ? <ChevronRight className="h-4 w-4 text-accent" aria-hidden="true" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="automint-shell min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-border bg-background/85 px-4 py-5 backdrop-blur-xl lg:block">
        <Logo />
        <div className="mt-8">
          <Navigation />
        </div>
        <div className="absolute bottom-5 left-4 right-4 rounded-lg border border-border bg-surface/80 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-success/10 text-success">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-text">Automation safe</p>
              <p className="text-xs text-muted">Risk gates active</p>
            </div>
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl lg:ml-72">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-white/5 text-muted hover:text-text lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="lg:hidden">
            <Logo />
          </div>

          <div className="ml-auto flex flex-1 items-center justify-end gap-2">
            <label className="relative hidden w-full max-w-md md:block">
              <span className="sr-only">Search AutoMint</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                type="search"
                placeholder="Search collections, wallets, tasks"
                className="h-10 w-full rounded-lg border border-border bg-white/5 pl-10 pr-3 text-sm text-text placeholder:text-muted/70 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-white/5 text-muted transition hover:text-text"
              aria-label="View notifications"
            >
              <Bell className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="flex h-10 items-center rounded-lg border border-border bg-white/5 px-2">
              <UserButton />
            </div>
          </div>
        </div>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
            aria-label="Close navigation overlay"
          />
          <div className="absolute inset-y-0 left-0 w-[min(88vw,320px)] border-r border-border bg-background p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-white/5 text-muted"
                aria-label="Close navigation"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-8">
              <Navigation onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}

      <main className="lg:ml-72">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:py-8">
          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { label: 'Live monitors', value: '148', icon: Activity, color: 'text-accent' },
              { label: 'Avg latency', value: '218ms', icon: Clock3, color: 'text-success' },
              { label: 'Risk blocks', value: '12', icon: ShieldCheck, color: 'text-warning' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 rounded-lg border border-border bg-surface/55 px-4 py-3">
                <item.icon className={`h-4 w-4 ${item.color}`} aria-hidden="true" />
                <span className="text-xs uppercase text-muted">{item.label}</span>
                <span className="ml-auto font-mono text-sm text-text">{item.value}</span>
              </div>
            ))}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
