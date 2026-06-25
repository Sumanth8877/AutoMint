'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, TestTube2 } from 'lucide-react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { apiRequest } from '@/lib/api/client';
import UsageDashboard from '@/components/settings/UsageDashboard';

type IntegrationStatus = 'UNKNOWN' | 'PASS' | 'FAIL';

type IntegrationVariable = {
  variableName: string;
  serviceName: string;
  configured: boolean;
  source: 'Environment';
  status: IntegrationStatus;
  latency: number | null;
  error: string | null;
  lastTestedAt: string | null;
};

type IntegrationSummary = {
  totalIntegrationsDetected: number;
  configuredIntegrations: number;
  testedIntegrations: number;
  passingIntegrations: number;
  failingIntegrations: number;
};

type IntegrationStatusResponse = {
  integrations: IntegrationVariable[];
  summary: IntegrationSummary;
};

type StatusFilter = 'all' | 'passing' | 'failing' | 'untested';

function statusBadgeVariant(status: IntegrationStatus) {
  if (status === 'PASS') return 'success';
  if (status === 'FAIL') return 'danger';
  return 'default';
}

function formatTime(value: string | null) {
  if (!value) return 'Not tested';
  return new Date(value).toLocaleString();
}

export default function ApiKeysClient() {
  const [payload, setPayload] = useState<IntegrationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const summary = payload?.summary;
  const filteredGroups = useMemo(() => {
    const visible = (payload?.integrations ?? []).filter((integration) => {
      if (statusFilter === 'passing') return integration.status === 'PASS';
      if (statusFilter === 'failing') return integration.status === 'FAIL';
      if (statusFilter === 'untested') return integration.status === 'UNKNOWN';
      return true;
    });
    const groups = new Map<string, IntegrationVariable[]>();

    for (const integration of visible) {
      const existing = groups.get(integration.serviceName) ?? [];
      existing.push(integration);
      groups.set(integration.serviceName, existing);
    }

    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [payload, statusFilter]);

  function handlePayload(response: IntegrationStatusResponse) {
    setPayload(response);
    setLastRefreshAt(new Date().toISOString());
  }

  async function loadIntegrations() {
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<IntegrationStatusResponse>('/api/settings/integrations');
      handlePayload(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load integration status.');
      setLastRefreshAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }

  async function testAllIntegrations() {
    setTesting(true);
    setError(null);
    try {
      const response = await apiRequest<IntegrationStatusResponse>('/api/settings/integrations', {
        method: 'POST',
        cache: 'no-store',
      });
      handlePayload(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to test integrations.');
      setLastRefreshAt(new Date().toISOString());
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    let active = true;

    apiRequest<IntegrationStatusResponse>('/api/settings/integrations')
      .then((response) => {
        if (!active) return;
        handlePayload(response);
        setError(null);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load integration status.');
        setLastRefreshAt(new Date().toISOString());
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/settings" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
          <h1 className="mt-3 text-2xl font-semibold text-text sm:text-3xl">API Keys</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Runtime integration status from environment configuration. Secret values are never displayed.
          </p>
          <p className="mt-2 text-xs text-muted">
            Last Refresh: {formatTime(lastRefreshAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={loadIntegrations} disabled={loading || testing}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
          <Button type="button" onClick={testAllIntegrations} loading={testing} disabled={loading}>
            <TestTube2 className="h-4 w-4" aria-hidden="true" />
            Test All Integrations
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <MetricCard label="Total Detected" value={summary?.totalIntegrationsDetected ?? 0} detail="Environment entries" tone="accent" />
        <MetricCard label="Configured" value={summary?.configuredIntegrations ?? 0} detail="Available at runtime" tone="success" />
        <MetricCard label="Tested" value={summary?.testedIntegrations ?? 0} detail="Attempted checks" tone="primary" />
        <MetricCard label="Passing" value={summary?.passingIntegrations ?? 0} detail="Healthy checks" tone="success" />
        <MetricCard label="Failing" value={summary?.failingIntegrations ?? 0} detail="Needs attention" tone={summary?.failingIntegrations ? 'danger' : 'muted'} />
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      {/* ── Free Tier Usage Dashboard ─────────────────────────────────────────── */}
      <Card className="mt-6">
        <div className="p-6">
          <UsageDashboard />
        </div>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="font-semibold text-text">Integration Variables</h2>
          <div className="flex flex-wrap gap-2">
            {[
              ['all', 'All'],
              ['passing', 'Passing'],
              ['failing', 'Failing'],
              ['untested', 'Untested'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value as StatusFilter)}
                className={`h-8 rounded-lg border px-3 text-xs font-medium transition ${
                  statusFilter === value
                    ? 'border-primary/40 bg-primary/15 text-text'
                    : 'border-border bg-white/5 text-muted hover:text-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="border-b border-border bg-white/5 text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Variable Name</th>
                <th className="px-4 py-3 font-medium">Service Name</th>
                <th className="px-4 py-3 font-medium">Configured</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Last Tested</th>
                <th className="px-4 py-3 font-medium">Latency</th>
                <th className="px-4 py-3 font-medium">Error Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td className="px-4 py-8 text-center text-muted" colSpan={8}>Loading integration status...</td>
                </tr>
              ) : payload && payload.integrations.length > 0 ? (
                filteredGroups.length > 0 ? (
                  filteredGroups.map(([serviceName, integrations]) => (
                    <Fragment key={serviceName}>
                      <tr className="bg-white/[0.03]">
                        <td className="px-4 py-3 font-semibold text-text" colSpan={8}>
                          {serviceName}
                        </td>
                      </tr>
                      {integrations.map((integration) => (
                        <tr key={integration.variableName}>
                          <td className="px-4 py-3 font-mono text-text">{integration.variableName}</td>
                          <td className="px-4 py-3 text-text">{integration.serviceName}</td>
                          <td className="px-4 py-3">
                            <Badge variant={integration.configured ? 'success' : 'danger'}>{integration.configured ? 'YES' : 'NO'}</Badge>
                          </td>
                          <td className="px-4 py-3 text-muted">{integration.source}</td>
                          <td className="px-4 py-3">
                            <Badge variant={statusBadgeVariant(integration.status)}>{integration.status}</Badge>
                          </td>
                          <td className="px-4 py-3 text-muted">{formatTime(integration.lastTestedAt)}</td>
                          <td className="px-4 py-3 font-mono text-muted">{integration.latency === null ? '-' : `${integration.latency}ms`}</td>
                          <td className="max-w-[320px] px-4 py-3 text-danger">{integration.error ?? '-'}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-8 text-center text-muted" colSpan={8}>No integrations match this filter.</td>
                  </tr>
                )
              ) : (
                <tr>
                  <td className="px-4 py-8 text-center text-muted" colSpan={8}>No integration environment variables detected.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      
    </div>
  );
}
