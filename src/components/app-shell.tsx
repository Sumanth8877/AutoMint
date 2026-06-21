'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import AutoMintUserButton from '@/components/auth/automint-user-button';
import { apiRequest } from '@/lib/api/client';
import {
  BarChart3,
  Bell,
  ChevronRight,
  FolderKanban,
  Gauge,
  History,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
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

type SearchResult = {
  id: string;
  type: 'wallet' | 'collection' | 'mint';
  title: string;
  subtitle: string | null;
  href: string;
};

type ActivityItem = {
  id: string;
  title: string;
  type: string;
  createdAt: string;
};

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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);

      try {
        const payload = await apiRequest<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setSearchResults(payload.results ?? []);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSearchResults([]);
        setSearchError(error instanceof Error ? error.message : 'Search failed.');
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [search]);

  const openNotifications = async () => {
    setNotificationsOpen((value) => !value);

    if (notificationsOpen || activities.length > 0 || activitiesLoading) return;

    setActivitiesLoading(true);
    setActivitiesError(null);

    try {
      const payload = await apiRequest<{ activities: ActivityItem[] }>('/api/activities');
      setActivities(payload.activities ?? []);
    } catch (error) {
      setActivitiesError(error instanceof Error ? error.message : 'Failed to load notifications.');
    } finally {
      setActivitiesLoading(false);
    }
  };

  const navigateToSearchResult = (result: SearchResult) => {
    setSearch('');
    setSearchResults([]);
    router.push(result.href);
  };

  return (
    <div className="automint-shell min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-border bg-background/85 px-4 py-5 backdrop-blur-xl lg:block">
        <Logo />
        <div className="mt-8">
          <Navigation />
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
            <div className="relative hidden w-full max-w-md md:block">
              <label htmlFor="automint-global-search" className="sr-only">Search AutoMint</label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                id="automint-global-search"
                type="search"
                value={search}
                onChange={(event) => {
                  const value = event.target.value;
                  setSearch(value);
                  if (value.trim().length < 2) {
                    setSearchResults([]);
                    setSearchError(null);
                    setSearchLoading(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && searchResults[0]) {
                    event.preventDefault();
                    navigateToSearchResult(searchResults[0]);
                  }
                }}
                placeholder="Search collections, wallets, tasks"
                className="h-10 w-full rounded-lg border border-border bg-white/5 pl-10 pr-3 text-sm text-text placeholder:text-muted/70 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              {search.trim().length >= 2 ? (
                <div className="absolute right-0 top-12 z-50 w-full overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl">
                  {searchLoading ? (
                    <div className="p-3 text-sm text-muted">Searching...</div>
                  ) : searchError ? (
                    <div className="p-3 text-sm text-danger" role="alert">{searchError}</div>
                  ) : searchResults.length > 0 ? (
                    <div className="max-h-80 overflow-y-auto py-1">
                      {searchResults.map((result) => (
                        <button
                          key={`${result.type}-${result.id}`}
                          type="button"
                          onClick={() => navigateToSearchResult(result)}
                          className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-white/5"
                        >
                          <span className="rounded border border-border px-2 py-0.5 text-[11px] uppercase text-muted">{result.type}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-text">{result.title}</span>
                            <span className="block truncate text-xs text-muted">{result.subtitle ?? result.href}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 text-sm text-muted">No matches found.</div>
                  )}
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={openNotifications}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-white/5 text-muted transition hover:text-text"
                aria-label="View notifications"
                aria-expanded={notificationsOpen}
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
              </button>
              {notificationsOpen ? (
                <div className="absolute right-0 top-12 z-50 w-80 overflow-hidden rounded-lg border border-border bg-elevated shadow-2xl">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold text-text">Notifications</p>
                  </div>
                  {activitiesLoading ? (
                    <div className="p-4 text-sm text-muted">Loading notifications...</div>
                  ) : activitiesError ? (
                    <div className="p-4 text-sm text-danger" role="alert">{activitiesError}</div>
                  ) : activities.length > 0 ? (
                    <div className="max-h-80 overflow-y-auto divide-y divide-border">
                      {activities.slice(0, 8).map((activity) => (
                        <div key={activity.id} className="p-4">
                          <p className="text-sm font-medium text-text">{activity.title}</p>
                          <p className="mt-1 text-xs text-muted">{activity.type} / {new Date(activity.createdAt).toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-sm text-muted">No notifications yet.</div>
                  )}
                </div>
              ) : null}
            </div>
            <div className="flex h-10 items-center rounded-lg border border-border bg-white/5 px-2">
              <AutoMintUserButton />
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
          {children}
        </div>
      </main>
    </div>
  );
}
