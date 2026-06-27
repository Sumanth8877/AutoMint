"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/page-header";

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  if (pct >= 50) return "bg-yellow-400";
  return "bg-green-500";
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ApiKeysClient({ configured }: { configured: boolean }) {
  const [stats, setStats] = useState<UsageStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const didFetch = useRef<boolean | null>(null);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/usage");
      if (!res.ok) return;
      const data = (await res.json()) as { stats: UsageStat[]; fetchedAt: string };
      setStats(data.stats);
      setFetchedAt(data.fetchedAt);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch once on first render (using null-check pattern required by react-hooks/refs)
  if (didFetch.current === null) {
    didFetch.current = true;
    void fetchUsage();
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 text-sm text-muted hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Link>
      </div>

      <PageHeader
        title="API Keys"
        description="Status overview of configured API keys and their usage. Keys are managed via environment variables in Vercel."
      />

      {/* ── AutoMint API Key Status ─────────────────────────────────── */}
      <Card className="p-6">
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted">
            AUTOMINT_API_KEY
          </div>

          <div className="flex items-center gap-3 rounded-lg border border-border bg-background/60 p-4">
            {configured ? (
              <>
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                <div>
                  <span className="text-sm font-medium text-text">Configured</span>
                  <p className="text-xs text-muted">
                    Programmatic access is enabled. The key is set via the{" "}
                    <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">
                      AUTOMINT_API_KEY
                    </code>{" "}
                    environment variable.
                  </p>
                </div>
              </>
            ) : (
              <>
                <XCircle className="h-5 w-5 shrink-0 text-red-500" />
                <div>
                  <span className="text-sm font-medium text-text">Not configured</span>
                  <p className="text-xs text-muted">
                    Set the{" "}
                    <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">
                      AUTOMINT_API_KEY
                    </code>{" "}
                    environment variable in your Vercel project to enable programmatic access.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* ── Service Usage / Limits ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text">Service Usage</h2>
        <button
          type="button"
          onClick={() => void fetchUsage()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-muted transition hover:bg-white/5 hover:text-text disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {stats.length === 0 && !loading && (
        <Card className="p-6">
          <p className="text-sm text-muted">No usage data available yet.</p>
        </Card>
      )}

      {loading && stats.length === 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm text-muted">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Loading usage data…
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.service} className="p-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg" role="img" aria-label={stat.service}>
                    {stat.icon}
                  </span>
                  <span className="text-sm font-medium text-text">{stat.service}</span>
                </div>
                {stat.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
              </div>

              <div className="text-xs text-muted">{stat.label}</div>

              {stat.used !== null && stat.limit !== null ? (
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-mono text-text">
                      {formatNumber(stat.used)} / {formatNumber(stat.limit)}{" "}
                      <span className="text-muted">{stat.unit}</span>
                    </span>
                    {stat.pct !== null && (
                      <span className="font-mono text-muted">{stat.pct}%</span>
                    )}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all ${barColor(stat.pct ?? 0)}`}
                      style={{ width: `${Math.min(100, stat.pct ?? 0)}%` }}
                    />
                  </div>
                </div>
              ) : stat.error ? (
                <p className="text-xs text-red-400">{stat.error}</p>
              ) : (
                <p className="text-xs text-muted">No usage data</p>
              )}

              <p className="text-[11px] leading-snug text-muted/70">{stat.tip}</p>
            </div>
          </Card>
        ))}
      </div>

      {fetchedAt && (
        <p className="text-xs text-muted">
          Last updated: {new Date(fetchedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
