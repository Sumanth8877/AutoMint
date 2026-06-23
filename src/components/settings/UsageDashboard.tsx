'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, ExternalLink, CheckCircle2, Clock } from 'lucide-react';

// ── Types (mirrored from the API route) ───────────────────────────────────────

type UsageStat = {
  service: string;
  label: string;
  icon: string;
  used: number | null;
  limit: number | null;
  unit: string;
  period: string;
  pct: number | null;
  tip: string;
  ok: boolean;
  error?: string;
};

type UsageResponse = {
  stats: UsageStat[];
  fetchedAt: string;
};

// ── Usage bar colour ──────────────────────────────────────────────────────────

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  if (pct >= 50) return 'bg-yellow-400';
  return 'bg-green-500';
}

function textColor(pct: number): string {
  if (pct >= 90) return 'text-red-600 dark:text-red-400';
  if (pct >= 70) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

// ── Dashboard links for services that don't expose API usage ─────────────────

const DASHBOARD_LINKS: Record<string, string> = {
  'Alchemy':   'https://dashboard.alchemy.com',
  'Vercel':    'https://vercel.com/dashboard',
  'Sentry':    'https://sentry.io',
  'Browserbase': 'https://browserbase.com/dashboard',
};

// ── Single usage card ─────────────────────────────────────────────────────────

function UsageCard({ stat }: { stat: UsageStat }) {
  const dashboardUrl = DASHBOARD_LINKS[stat.service];
  const hasRealData = stat.used !== null && stat.limit !== null && stat.pct !== null;
  const p = stat.pct ?? 0;

  return (
    <div className={`rounded-xl border p-4 space-y-3 transition-colors ${
      !stat.ok && !hasRealData
        ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 opacity-60'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none" aria-hidden>{stat.icon}</span>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{stat.service}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{stat.label}</p>
          </div>
        </div>
        {dashboardUrl && (
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-400 hover:text-indigo-500 transition-colors"
            title={`Open ${stat.service} dashboard`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {/* Usage bar */}
      {hasRealData ? (
        <div className="space-y-1.5">
          <div className="flex items-end justify-between gap-2">
            <span className={`text-2xl font-black tabular-nums ${textColor(p)}`}>
              {stat.used!.toLocaleString()}
              <span className="text-xs font-normal text-gray-400 ml-1">{stat.unit}</span>
            </span>
            <span className="text-xs text-gray-400 tabular-nums">
              {p}% of {stat.limit!.toLocaleString()}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${barColor(p)}`}
              style={{ width: `${p}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {stat.period} · {(stat.limit! - stat.used!).toLocaleString()} {stat.unit} remaining
          </p>
        </div>
      ) : stat.error ? (
        <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{stat.error}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          <span>Configured — check dashboard for live usage</span>
        </div>
      )}

      {/* Tip */}
      <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed border-t border-gray-100 dark:border-gray-800 pt-2">
        {stat.tip}
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UsageDashboard() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/usage', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to fetch usage (${res.status})`);
      const json = await res.json() as UsageResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch_ is a stable callback that correctly chains setState; this is a safe initial-load pattern
  useEffect(() => { fetch_().catch(() => undefined); }, [fetch_]);

  const tracked = (data?.stats ?? []).filter(s => s.used !== null);
  const nearLimit = (data?.stats ?? []).filter(s => (s.pct ?? 0) >= 70);

  return (
    <section className="space-y-5">
      {/* Section header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">Free Tier Usage</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Live usage across all your integrations — no more logging into each dashboard.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void fetch_(); }}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-all"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Near-limit warning banner */}
      {nearLimit.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            <strong>{nearLimit.map(s => s.service).join(', ')}</strong> {nearLimit.length === 1 ? 'is' : 'are'} approaching the free tier limit.
          </span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 space-y-3 animate-pulse">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-gray-200 dark:bg-gray-700" />
                <div className="space-y-1 flex-1">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                  <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
                </div>
              </div>
              <div className="h-8 bg-gray-100 dark:bg-gray-800 rounded" />
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {/* Stats grid */}
      {data && (
        <>
          {tracked.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              Live data from {tracked.length} service{tracked.length !== 1 ? 's' : ''}
              {data.fetchedAt && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(data.fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.stats.map(stat => (
              <UsageCard key={stat.service} stat={stat} />
            ))}
          </div>

          {/* Footer note */}
          <p className="text-xs text-gray-400 dark:text-gray-500">
            * Some services (Alchemy, Vercel) don&apos;t expose usage via API on the free tier. Click the external link icon to open their dashboards.
          </p>
        </>
      )}
    </section>
  );
}
