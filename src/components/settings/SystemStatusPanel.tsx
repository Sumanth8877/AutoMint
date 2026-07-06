'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

type ServiceStatus = {
  status: 'healthy' | 'unhealthy' | 'unknown';
  detail?: string;
  latencyMs?: number;
};

type FailedJob = {
  source: 'mint_task' | 'qstash_dlq';
  id: string;
  label: string;
  reason: string;
  failedAt: string | null;
};

type SystemStatusSnapshot = {
  checkedAt: string;
  database: ServiceStatus;
  redis: ServiceStatus;
  rpc: Record<string, ServiceStatus>;
  recoveryLoop: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    lastHeartbeat: string | null;
    staleAfterMinutes: number;
  };
  failedJobs: FailedJob[];
};

function StatusBadge({ status }: { status: ServiceStatus['status'] }) {
  if (status === 'healthy') {
    return (
      <Badge variant="success" dot>
        <CheckCircle2 className="h-3 w-3" /> Healthy
      </Badge>
    );
  }
  if (status === 'unhealthy') {
    return (
      <Badge variant="danger" dot>
        <AlertTriangle className="h-3 w-3" /> Unhealthy
      </Badge>
    );
  }
  return (
    <Badge variant="default" dot>
      <HelpCircle className="h-3 w-3" /> Unknown
    </Badge>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function SystemStatusPanel() {
  const [snapshot, setSnapshot] = useState<SystemStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);  const load = useCallback(async (): Promise<{ snapshot?: SystemStatusSnapshot; error?: string }> => {
    try {
      const res = await fetch('/api/system/status');
      if (!res.ok) throw new Error(`Status check failed (${res.status})`);
      const data = (await res.json()) as SystemStatusSnapshot;
      return { snapshot: data };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Failed to load system status' };
    }
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void load().then((result) => {
      if (result.snapshot) setSnapshot(result.snapshot);
      if (result.error) setError(result.error);
      setLoading(false);
    });
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void load().then((result) => {
      if (cancelled) return;
      if (result.snapshot) setSnapshot(result.snapshot);
      if (result.error) setError(result.error);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [load]);

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-text">System Status</h3>
          <p className="mt-0.5 text-sm text-muted">
            {snapshot ? `Checked ${relativeTime(snapshot.checkedAt)}` : 'Live health of the mint-execution pipeline'}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text transition hover:bg-surface-hover disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-danger/20 bg-red-50 p-3 text-sm text-danger">{error}</div>
      )}

      {snapshot && (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs font-medium text-muted">Database</div>
              <div className="mt-1.5"><StatusBadge status={snapshot.database.status} /></div>
              {snapshot.database.latencyMs != null && (
                <div className="mt-1 text-xs text-muted">{snapshot.database.latencyMs}ms</div>
              )}
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs font-medium text-muted">Redis</div>
              <div className="mt-1.5"><StatusBadge status={snapshot.redis.status} /></div>
              {snapshot.redis.latencyMs != null && (
                <div className="mt-1 text-xs text-muted">{snapshot.redis.latencyMs}ms</div>
              )}
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs font-medium text-muted">Recovery loop</div>
              <div className="mt-1.5"><StatusBadge status={snapshot.recoveryLoop.status} /></div>
              <div className="mt-1 text-xs text-muted">Last run {relativeTime(snapshot.recoveryLoop.lastHeartbeat)}</div>
            </div>
            {Object.entries(snapshot.rpc).map(([provider, health]) => (
              <div key={provider} className="rounded-lg border border-border p-3">
                <div className="text-xs font-medium capitalize text-muted">{provider} RPC</div>
                <div className="mt-1.5"><StatusBadge status={health.status} /></div>
                {health.detail && <div className="mt-1 truncate text-xs text-muted" title={health.detail}>{health.detail}</div>}
              </div>
            ))}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-text">Recently failed jobs</h4>
            {snapshot.failedJobs.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No failed jobs to show. 🎉</p>
            ) : (
              <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                {snapshot.failedJobs.map((job) => (
                  <div key={`${job.source}-${job.id}`} className="flex items-start justify-between gap-4 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-text">{job.label}</span>
                        <Badge variant={job.source === 'qstash_dlq' ? 'warning' : 'default'} className="shrink-0">
                          {job.source === 'qstash_dlq' ? 'QStash DLQ' : 'Mint task'}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted" title={job.reason}>{job.reason}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{relativeTime(job.failedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
