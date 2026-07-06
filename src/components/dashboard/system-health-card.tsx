'use client';

/**
 * Dashboard "System Health" card -- an issues-only view of the same real
 * health checks used on Settings > System (DB, Redis, RPC providers,
 * recovery loop).
 *
 * This fetches client-side, same as SystemStatusPanel on Settings > System,
 * rather than being bundled into the dashboard's server-side data fetch.
 * That matters: the dashboard SSR already runs several DB queries in
 * parallel (wallets, collections, mint history, tasks, activities); adding
 * a multi-check health probe (DB ping + Redis ping + 3x RPC reads +
 * recovery-loop read + a failed-tasks query) into that same request
 * competed for connections/time and was intermittently failing the whole
 * snapshot in production, even though the exact same check succeeds fine
 * as its own isolated request on Settings > System. Fetching it
 * independently, after the main dashboard content has already rendered,
 * avoids that contention entirely.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, HelpCircle } from 'lucide-react';
import Card from '@/components/ui/Card';

type ServiceStatusValue = 'healthy' | 'unhealthy' | 'unknown';

type ServiceStatus = {
  status: ServiceStatusValue;
  detail?: string;
};

type SystemStatusSnapshot = {
  checkedAt: string;
  database: ServiceStatus;
  redis: ServiceStatus;
  rpc: Record<string, ServiceStatus>;
  recoveryLoop: { status: ServiceStatusValue; lastHeartbeat: string | null };
};

const STATUS_DISPLAY: Record<ServiceStatusValue, { label: string; icon: typeof CheckCircle2; color: string }> = {
  healthy: { label: 'healthy', icon: CheckCircle2, color: 'text-success' },
  unhealthy: { label: 'unhealthy', icon: AlertTriangle, color: 'text-danger' },
  unknown: { label: 'unknown', icon: HelpCircle, color: 'text-muted' },
};

function toTitleCase(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function DashboardSystemHealthCard() {
  const [snapshot, setSnapshot] = useState<SystemStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const load = useCallback(async (): Promise<{ snapshot?: SystemStatusSnapshot; error?: boolean }> => {
    try {
      const res = await fetch('/api/system/status');
      if (!res.ok) throw new Error(`Status check failed (${res.status})`);
      const data = (await res.json()) as SystemStatusSnapshot;
      return { snapshot: data };
    } catch {
      return { error: true };
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      if (result.snapshot) setSnapshot(result.snapshot);
      if (result.error) setErrored(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [load]);

  const checks: { label: string; status: ServiceStatusValue; detail?: string }[] = snapshot
    ? [
        { label: 'Database', status: snapshot.database.status, detail: snapshot.database.detail },
        { label: 'Cache (Redis)', status: snapshot.redis.status, detail: snapshot.redis.detail },
        ...Object.entries(snapshot.rpc).map(([provider, health]) => ({
          label: `${toTitleCase(provider)} RPC`,
          status: health.status,
          detail: health.detail,
        })),
        { label: 'Recovery Loop', status: snapshot.recoveryLoop.status },
      ]
    : [];

  const issues = checks.filter((c) => c.status !== 'healthy');

  return (
    <Card tone="default" className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">System Health</p>
        <Link href="/settings/system" className="text-xs font-medium text-primary hover:underline">
          Details
        </Link>
      </div>

      {loading && (
        <div className="space-y-2">
          <div className="h-9 animate-pulse rounded-lg bg-surface-hover" />
          <div className="h-9 w-2/3 animate-pulse rounded-lg bg-surface-hover" />
        </div>
      )}

      {!loading && errored && (
        <div className="flex items-start gap-2.5 rounded-lg bg-surface-hover px-3 py-2.5">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
          <p className="text-xs text-muted">Could not reach the health check service.</p>
        </div>
      )}

      {!loading && !errored && issues.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          <span className="text-xs font-semibold text-success">All systems operational</span>
        </div>
      )}

      {!loading && !errored && issues.length > 0 && (
        <div className="space-y-2">
          {issues.map((c) => {
            const display = STATUS_DISPLAY[c.status];
            return (
              <div key={c.label} className="flex items-start gap-2.5 rounded-lg bg-surface-hover px-3 py-2.5">
                <display.icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${display.color}`} />
                <div className="min-w-0">
                  <p className={`text-xs font-semibold ${display.color}`}>{c.label} {display.label}</p>
                  {c.detail && <p className="mt-0.5 truncate text-xs text-muted" title={c.detail}>{c.detail}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
