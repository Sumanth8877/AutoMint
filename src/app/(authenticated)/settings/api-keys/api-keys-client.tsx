'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, TestTube2 } from 'lucide-react';
import Link from 'next/link';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { apiRequest } from '@/lib/api/client';

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

  const summary = payload?.summary;
  const grouped = useMemo(() => {
    const groups = new Map<string, IntegrationVariable[]>();

    for (const integration of payload?.integrations ?? []) {
      const existing = groups.get(integration.serviceName) ?? [];
      existing.push(integration);
      groups.set(integration.serviceName, existing);
    }

    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [payload]);

  async function loadIntegrations() {
    setError(null);
    try {
      const response = await apiRequest<IntegrationStatusResponse>('/api/settings/integrations');
      setPayload(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to load integration status.');
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
      });
      setPayload(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to test integrations.');
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    let active = true;

    apiRequest<IntegrationStatusResponse>('/api/settings/integrations')
      .then((response) => {
        if (!active) return;
        setPayload(response);
        setError(null);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load integration status.');
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

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold text-text">Integration Variables</h2>
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
                payload.integrations.map((integration) => (
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
                ))
              ) : (
                <tr>
                  <td className="px-4 py-8 text-center text-muted" colSpan={8}>No integration environment variables detected.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {grouped.map(([serviceName, integrations]) => {
          const configured = integrations.filter((item) => item.configured).length;
          const failing = integrations.some((item) => item.status === 'FAIL');
          const passing = integrations.some((item) => item.status === 'PASS');

          return (
            <Card key={serviceName} className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-text">{serviceName}</h3>
                  <p className="mt-1 text-xs text-muted">{configured}/{integrations.length} configured</p>
                </div>
                <Badge variant={failing ? 'danger' : passing ? 'success' : 'default'}>
                  {failing ? 'FAIL' : passing ? 'PASS' : 'UNKNOWN'}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {integrations.map((integration) => (
                  <span key={integration.variableName} className="rounded border border-border bg-white/5 px-2 py-1 font-mono text-xs text-muted">
                    {integration.variableName}
                  </span>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
