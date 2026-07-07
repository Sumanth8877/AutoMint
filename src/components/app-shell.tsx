'use client';

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import AutoMintUserButton from '@/components/auth/automint-user-button';
import { AIProviderBanner } from '@/components/dashboard/ai-provider-banner';
import { AIProviderStatus } from '@/components/dashboard/ai-provider-banner';
import { apiRequest } from '@/lib/api/client';
import {
  BarChart3, Bell, ChevronRight, FolderKanban, Gauge, History,
  LayoutDashboard, Menu, Search, Settings,
  Telescope, Wallet, X, Zap, Activity,
} from 'lucide-react';

const navGroups = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Mint Ops',
    items: [
      { href: '/analyzer', label: 'Analyzer', icon: Gauge },
      { href: '/mints', label: 'Mints', icon: Zap },
      { href: '/collections', label: 'Collections', icon: FolderKanban },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/whale-tracker', label: 'Whale Tracker', icon: Telescope },
      { href: '/wl-tracker', label: 'WL Tracker', icon: Bell },
      { href: '/history', label: 'History', icon: History },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/wallets', label: 'Wallets', icon: Wallet },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const navItems = navGroups.flatMap((group) => group.items);

type SearchResult = {
  id: string;
  type: 'wallet' | 'collection' | 'mint';
  title: string;
  subtitle: string | null;
  href: string;
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-3 group" aria-label="AutoMint home">
      <div
        className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg transition-transform duration-200 group-hover:scale-105"
      >
        <Image src="/icon-192.png" alt="" fill sizes="36px" className="object-contain" priority />
      </div>
      <div>
        <p className="text-sm font-bold tracking-tight text-text">AutoMint</p>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary/70">NFT Intelligence</p>
      </div>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-5" aria-label="Main navigation">
      {navGroups.map((group) => (
        <div key={group.label} className="space-y-0.5">
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted/60">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex h-10 items-center justify-between rounded-lg px-3 text-sm transition-all duration-200 ${
                  active
                    ? 'nav-item-active font-semibold'
                    : 'text-secondary hover:bg-surface-hover hover:text-text'
                }`}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                )}
                <span className="flex items-center gap-3">
                  <Icon
                    className={`h-4 w-4 transition-colors ${active ? 'text-primary' : 'text-muted group-hover:text-secondary'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {active && <ChevronRight className="h-3 w-3 text-primary/60" aria-hidden="true" />}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="flex h-full flex-col gap-6 px-4 pt-6 pb-4">
      <Logo />
      <div className="h-px bg-border" />
      <div className="flex-1 overflow-y-auto">
        <Navigation onNavigate={onNavigate} />
      </div>
      <div className="h-px bg-border" />
      <div className="space-y-2">
        <AutoMintUserButton />
        <div className="flex items-center justify-center gap-1.5">
          <AIProviderStatus />
        </div>
        <div className="flex items-center justify-center gap-1.5">
          <span className="live-dot" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted/70">System Live</span>
        </div>
      </div>
    </aside>
  );
}

function TopBar({
  onMenuClick, onSearch, searchOpen, searchQuery, setSearchQuery, searchResults, searching,
}: {
  onMenuClick: () => void;
  onSearch: (q: string) => void;
  searchOpen: boolean;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchResults: SearchResult[];
  searching: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = navItems.find(n => pathname.startsWith(n.href));

  const listboxId = 'topbar-search-results';
  const visibleResults = searchResults.slice(0, 6);
  const open = searchOpen && visibleResults.length > 0;
  const [activeIndex, setActiveIndex] = useState(-1);
  // Clamp in render so the highlight can never point past a shrunk result list.
  const safeActiveIndex = activeIndex < visibleResults.length ? activeIndex : -1;

  function handleSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setSearchQuery('');
      setActiveIndex(-1);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((safeActiveIndex + 1) % visibleResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(safeActiveIndex <= 0 ? visibleResults.length - 1 : safeActiveIndex - 1);
    } else if (e.key === 'Enter' && safeActiveIndex >= 0) {
      e.preventDefault();
      const r = visibleResults[safeActiveIndex];
      setSearchQuery('');
      setActiveIndex(-1);
      router.push(r.href);
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface backdrop-blur-sm px-4 sm:px-6">
      <button
        onClick={onMenuClick}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-text hover:bg-surface-hover transition-colors lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Current page title — mobile */}
      <div className="flex items-center gap-2 lg:hidden">
        {current && <current.icon className="h-4 w-4 text-primary" />}
        <span className="text-sm font-semibold text-text">{current?.label ?? 'AutoMint'}</span>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        {/* Search */}
        <div className="relative">
          <div className="flex items-center gap-2 h-9 rounded-lg border border-border bg-surface-hover px-3 text-sm text-muted hover:border-border-strong hover:text-text transition-all duration-200 min-w-[200px] sm:min-w-[260px]">
            <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <input
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={safeActiveIndex >= 0 ? `${listboxId}-${safeActiveIndex}` : undefined}
              aria-label="Search wallets, collections and mints"
              placeholder="Search wallets, contracts…"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setActiveIndex(-1); onSearch(e.target.value); }}
              onKeyDown={handleSearchKeyDown}
              className="flex-1 bg-transparent outline-none placeholder:text-muted/60 text-text text-xs"
            />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setActiveIndex(-1); onSearch(''); }}
                  className="flex items-center justify-center text-muted hover:text-text transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            {searching && <div className="h-3 w-3 rounded-full border border-primary/20 border-t-primary animate-spin shrink-0" aria-hidden="true" />}
          </div>

          {open && (
            <div
              id={listboxId}
              role="listbox"
              aria-label="Search results"
              className="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-border bg-surface shadow-lg z-50 overflow-hidden"
            >
              <div className="px-3 py-2 border-b border-border">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">{visibleResults.length} Results</p>
              </div>
              {visibleResults.map((r, i) => (
                <Link
                  key={r.id}
                  id={`${listboxId}-${i}`}
                  role="option"
                  aria-selected={i === safeActiveIndex}
                  href={r.href}
                  className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${i === safeActiveIndex ? 'bg-surface-hover' : 'hover:bg-surface-hover'}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => { setSearchQuery(''); setActiveIndex(-1); }}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface-hover text-xs font-bold text-muted uppercase" aria-hidden="true">
                    {r.type[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">{r.title}</p>
                    {r.subtitle && <p className="text-xs text-muted truncate">{r.subtitle}</p>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Live indicator */}
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-success/20 bg-emerald-50 px-3 py-1.5">
          <Activity className="h-3 w-3 text-success animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-success">Live</span>
        </div>
      </div>
    </header>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  async function handleSearch(query: string) {
    if (!query.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const data = await apiRequest<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`);
      setSearchResults(data.results ?? []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }

  return (
    <div className="automint-shell flex h-screen overflow-hidden relative z-0">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-surface">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-40 w-72 border-r border-border bg-surface shadow-lg lg:hidden">
            <div className="flex items-center justify-between px-4 pt-5 pb-3">
              <Logo />
              <button
                onClick={() => setMobileOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-text hover:bg-surface-hover transition-colors"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-4 flex-1 overflow-y-auto">
              <Navigation onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        </>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setMobileOpen(true)}
          onSearch={handleSearch}
          searchOpen={!!searchQuery}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchResults={searchResults}
          searching={searching}
        />
        <main className="flex-1 overflow-y-auto bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <AIProviderBanner />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
