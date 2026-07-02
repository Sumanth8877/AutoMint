'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AutoMintUserButton from '@/components/auth/automint-user-button';
import { apiRequest } from '@/lib/api/client';
import {
  BarChart3, ChevronRight, FolderKanban, Gauge, History,
  LayoutDashboard, Menu, Search, Settings,
  Telescope, Wallet, X, Zap, Activity,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard',     label: 'Dashboard',     icon: LayoutDashboard, glow: 'rgba(0,245,255,0.15)' },
  { href: '/analyzer',      label: 'Analyzer',      icon: Gauge,           glow: 'rgba(124,58,237,0.15)' },
  { href: '/collections',   label: 'Collections',   icon: FolderKanban,    glow: 'rgba(236,72,153,0.15)' },
  { href: '/mints',         label: 'Mints',         icon: Zap,             glow: 'rgba(245,158,11,0.15)' },
  { href: '/wallets',       label: 'Wallets',        icon: Wallet,          glow: 'rgba(16,185,129,0.15)' },
  { href: '/whale-tracker', label: 'Whale Tracker',  icon: Telescope,       glow: 'rgba(59,130,246,0.15)' },
  { href: '/analytics',     label: 'Analytics',     icon: BarChart3,       glow: 'rgba(0,245,255,0.12)' },
  { href: '/history',       label: 'History',        icon: History,         glow: 'rgba(124,58,237,0.12)' },
  { href: '/settings',      label: 'Settings',       icon: Settings,        glow: 'rgba(100,100,100,0.10)' },
];

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
        className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl transition-transform duration-300 group-hover:scale-105"
        style={{ boxShadow: '0 0 20px rgba(0,245,255,0.15)' }}
      >
        <Image src="/icon-192.png" alt="" fill sizes="40px" className="object-contain" priority />
      </div>
      <div>
        <p className="text-sm font-black tracking-tight text-text">AutoMint</p>
        <p className="text-[9px] font-bold uppercase tracking-[0.20em] text-neon/60">NFT INTELLIGENCE</p>
      </div>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-0.5" aria-label="Main navigation">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex h-10 items-center justify-between rounded-xl px-3 text-sm transition-all duration-200 ${
              active
                ? 'nav-item-active font-semibold'
                : 'text-muted hover:bg-white/5 hover:text-text'
            }`}
            style={active ? { boxShadow: `0 0 20px ${item.glow}` } : undefined}
          >
            {active && (
              <span
                className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                style={{ background: 'linear-gradient(to bottom, #00F5FF, #7C3AED)', boxShadow: '0 0 8px rgba(0,245,255,0.8)' }}
                aria-hidden="true"
              />
            )}
            <span className="flex items-center gap-3">
              <Icon
                className={`h-4 w-4 transition-colors ${active ? 'text-neon' : 'text-muted group-hover:text-secondary'}`}
                aria-hidden="true"
              />
              <span className="truncate">{item.label}</span>
            </span>
            {active && <ChevronRight className="h-3 w-3 text-neon/50" aria-hidden="true" />}
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="flex h-full flex-col gap-6 px-4 pt-6 pb-4">
      <Logo />
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      <div className="flex-1 overflow-y-auto">
        <Navigation onNavigate={onNavigate} />
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      <div className="space-y-2">
        <AutoMintUserButton />
        <div className="flex items-center justify-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(16,185,129,0.9)] animate-pulse" />
          <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted/70">System Live</span>
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
  const current = navItems.find(n => pathname.startsWith(n.href));

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border px-4 sm:px-6">
      <button
        onClick={onMenuClick}
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Current page title — mobile */}
      <div className="flex items-center gap-2 lg:hidden">
        {current && <current.icon className="h-4 w-4 text-neon" />}
        <span className="text-sm font-bold text-text">{current?.label ?? 'AutoMint'}</span>
      </div>

      <div className="flex flex-1 items-center justify-end gap-3">
        {/* Search */}
        <div className="relative">
          <div className="flex items-center gap-2 h-9 rounded-lg border border-border bg-surface px-3 text-sm text-muted hover:border-border-strong hover:text-text transition-all duration-200 cursor-pointer min-w-[200px] sm:min-w-[260px]">
            <Search className="h-3.5 w-3.5 shrink-0" />
            <input
              type="text"
              placeholder="Search wallets, contracts…"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); onSearch(e.target.value); }}
              className="flex-1 bg-transparent outline-none placeholder:text-muted/60 text-text text-xs"
            />
            {searching && <div className="h-3 w-3 rounded-full border border-neon/40 border-t-neon animate-spin shrink-0" />}
          </div>

          {searchOpen && searchResults.length > 0 && (
            <div className="absolute right-0 top-full mt-1.5 w-72 rounded-xl border border-border-strong bg-elevated shadow-[0_12px_48px_rgba(0,0,0,0.70)] z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{searchResults.length} Results</p>
              </div>
              {searchResults.slice(0, 6).map(r => (
                <Link
                  key={r.id}
                  href={r.href}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/5 transition-colors"
                  onClick={() => setSearchQuery('')}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface text-[10px] font-bold text-muted uppercase">
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
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-1.5">
          <Activity className="h-3 w-3 text-success animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-success">Live</span>
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
      <div className="hidden lg:flex w-60 shrink-0 flex-col border-r border-border bg-surface/50 backdrop-blur-sm">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-40 w-72 border-r border-border bg-background shadow-2xl lg:hidden">
            <div className="flex items-center justify-between px-4 pt-5 pb-3">
              <Logo />
              <button
                onClick={() => setMobileOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-text hover:bg-white/5 transition-colors"
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
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
