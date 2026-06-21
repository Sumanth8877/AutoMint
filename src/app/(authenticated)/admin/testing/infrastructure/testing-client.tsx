'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Play, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { apiRequest } from '@/lib/api/client';

type InfrastructureTestStatus = 'passed' | 'failed' | 'warning';

type InfrastructureTestResult = {
  service: string;
  status: InfrastructureTestStatus;
  score: number;
  latency: number;
  summary: string;
  reasoning: string;
  rootCause: string;
  fixRecommendation: string;
  response: Record<string, unknown>;
  testedAt: string;
};

type InfrastructureSummary = {
  overallScore: number;
  readiness: 'Production Ready' | 'Mostly Ready' | 'Needs Attention' | 'Critical Issues';
  reasoning: string;
  results: InfrastructureTestResult[];
  testedAt: string;
};

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

const statusMeta = {
  passed: {
    label: 'Passed',
    badge: 'success',
    row: 'border-success/20 bg-success/5',
    icon: CheckCircle2,
  },
  warning: {
    label: 'Warning',
    badge: 'warning',
    row: 'border-warning/20 bg-warning/5',
    icon: AlertTriangle,
  },
  failed: {
    label: 'Failed',
    badge: 'danger',
    row: 'border-danger/20 bg-danger/5',
    icon: XCircle,
  },
} as const;

function readinessTone(readiness: InfrastructureSummary['readiness']) {
  if (readiness === 'Production Ready') return 'success';
  if (readiness === 'Mostly Ready') return 'accent';
  if (readiness === 'Needs Attention') return 'warning';
  return 'danger';
}

function readinessBadge(readiness: InfrastructureSummary['readiness']): BadgeVariant {
  if (readiness === 'Mostly Ready') return 'info';
  if (readiness === 'Production Ready') return 'success';
  if (readiness === 'Needs Attention') return 'warning';
  return 'danger';
}

function formatDate(value: string) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export default function InfrastructureTestingClient() {
  const [summary, setSummary] = useState<InfrastructureSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const results = summary?.results ?? [];
    return {
      passed: results.filter((result) => result.status === 'passed').length,
      warning: results.filter((result) => result.status === 'warning').length,
      failed: results.filter((result) => result.status === 'failed').length,
    };
  }, [summary]);

  const runTests = async () => {
    setRunning(true);
    setError(null);
    try {
      const payload = await apiRequest<InfrastructureSummary>('/api/admin/testing/infrastructure', {
        method: 'POST',
      });
      setSummary(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to run infrastructure tests.');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    let active = true;

    apiRequest<InfrastructureSummary>('/api/admin/testing/infrastructure')
      .then((payload) => {
        if (!active) return;
        setSummary(payload);
        setError(null);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load infrastructure test results.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label="Overall Score"
          value={summary ? `${summary.overallScore}/100` : loading ? 'Loading' : '0/100'}
          detail={summary?.readiness ?? 'Awaiting test results'}
          icon={ShieldCheck}
          tone={summary ? readinessTone(summary.readiness) : 'muted'}
        />
        <MetricCard label="Passed" value={counts.passed} detail="Real checks succeeded" icon={CheckCircle2} tone="success" />
        <MetricCard label="Warnings" value={counts.warning} detail="Succeeded with issues" icon={AlertTriangle} tone="warning" />
        <MetricCard label="Failed" value={counts.failed} detail="Needs remediation" icon={ShieldAlert} tone="danger" />
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={summary ? readinessBadge(summary.readiness) : 'default'}>
                {summary?.readiness ?? 'No assessment'}
              </Badge>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                {summary ? formatDate(summary.testedAt) : 'No completed run'}
              </span>
            </div>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-muted">
              {summary?.reasoning ?? 'Run infrastructure tests to validate all production integrations with real requests.'}
            </p>
          </div>
          <Button type="button" onClick={runTests} loading={running} disabled={running}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Run Infrastructure Tests
          </Button>
        </div>
        {error ? (
          <div className="mt-4 rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
            {error}
          </div>
        ) : null}
      </Card>

      <div className="overflow-hidden rounded-lg border border-border bg-surface/75">
        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="border-b border-border bg-white/5 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Summary</th>
                <th className="px-4 py-3 font-medium">Reasoning</th>
                <th className="px-4 py-3 font-medium">Root Cause</th>
                <th className="px-4 py-3 font-medium">Fix Recommendation</th>
                <th className="px-4 py-3 font-medium">Last Tested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-muted" colSpan={9}>Loading infrastructure results...</td>
                </tr>
              ) : summary && summary.results.length > 0 ? (
                summary.results.map((result) => {
                  const meta = statusMeta[result.status];
                  const StatusIcon = meta.icon;
                  return (
                    <tr key={`${result.service}-${result.testedAt}`} className={meta.row}>
                      <td className="px-4 py-4 font-medium text-text">{result.service}</td>
                      <td className="px-4 py-4">
                        <Badge variant={meta.badge}>
                          <span className="inline-flex items-center gap-1.5">
                            <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            {meta.label}
                          </span>
                        </Badge>
                      </td>
                      <td className="px-4 py-4 font-mono text-text">{result.score}/100</td>
                      <td className="px-4 py-4 font-mono text-muted">{result.latency}ms</td>
                      <td className="max-w-[260px] px-4 py-4 text-text">{result.summary}</td>
                      <td className="max-w-[320px] px-4 py-4 text-muted">{result.reasoning}</td>
                      <td className="max-w-[260px] px-4 py-4 text-muted">{result.rootCause}</td>
                      <td className="max-w-[300px] px-4 py-4 text-muted">{result.fixRecommendation}</td>
                      <td className="px-4 py-4 text-muted">{formatDate(result.testedAt)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td className="px-4 py-8 text-center text-muted" colSpan={9}>No infrastructure test runs have been stored yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
