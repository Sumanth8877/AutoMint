'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Radio, Save, SlidersHorizontal } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { apiRequest } from '@/lib/api/client';
import type { RpcPreferredProvider, RpcRoutingMode } from '@/lib/services/rpc-provider-settings.service';

type ProviderName = 'ALCHEMY' | 'QUICKNODE';

type RpcProviderSettings = {
  id: string;
  routingMode: RpcRoutingMode;
  preferredProvider: RpcPreferredProvider | null;
  autoFailover: boolean;
  rpcTimeoutSeconds: number;
  updatedAt: string;
};

type ProviderStatus = {
  provider: ProviderName;
  configured: boolean;
  healthy: boolean;
  latency: number | null;
  status: 'Healthy' | 'Unavailable';
};

type RpcRouting = {
  currentActiveProvider: ProviderName | null;
  providers: ProviderStatus[];
};

type RpcProviderPayload = {
  settings: RpcProviderSettings;
  routing: RpcRouting;
};

const providerLabels: Record<ProviderName, string> = {
  ALCHEMY: 'Alchemy',
  QUICKNODE: 'QuickNode',
};

function settingsKey(settings: RpcProviderSettings | null) {
  if (!settings) return '';
  return JSON.stringify({
    routingMode: settings.routingMode,
    preferredProvider: settings.preferredProvider,
    autoFailover: settings.autoFailover,
    rpcTimeoutSeconds: settings.rpcTimeoutSeconds,
  });
}

function formatLatency(latency: number | null) {
  return latency === null ? 'Not measured' : `${latency}ms`;
}

export default function RpcProvidersClient() {
  const [payload, setPayload] = useState<RpcProviderPayload | null>(null);
  const [draft, setDraft] = useState<RpcProviderSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dirty = useMemo(() => settingsKey(payload?.settings ?? null) !== settingsKey(draft), [draft, payload]);
  const configuredProviders = payload?.routing.providers.filter((provider) => provider.configured) ?? [];

  useEffect(() => {
    let active = true;

    apiRequest<RpcProviderPayload>('/api/settings/rpc-providers')
      .then((response) => {
        if (!active) return;
        setPayload(response);
        setDraft(response.settings);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load RPC provider settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!success) return;

    const timeout = window.setTimeout(() => setSuccess(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [success]);

  function updateDraft<K extends keyof RpcProviderSettings>(key: K, value: RpcProviderSettings[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setSuccess(null);
  }

  async function saveSettings() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiRequest<RpcProviderPayload>('/api/settings/rpc-providers', {
        method: 'PATCH',
        cache: 'no-store',
        body: draft,
      });
      setPayload(response);
      setDraft(response.settings);
      setSuccess('RPC provider settings saved.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save RPC provider settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/settings" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
          <h1 className="mt-3 text-2xl font-semibold text-text sm:text-3xl">RPC Providers</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Control how AutoMint selects configured RPC providers during mint execution.
          </p>
        </div>
        <Button type="button" onClick={saveSettings} loading={saving} disabled={loading || !draft || !dirty}>
          <Save className="h-4 w-4" aria-hidden="true" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>

      {error ? <div className="mb-6 rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">{error}</div> : null}
      {success ? <div className="mb-6 rounded-lg border border-success/25 bg-success/10 px-4 py-3 text-sm text-success" role="status">{success}</div> : null}

      {loading || !draft || !payload ? (
        <Card className="p-6 text-sm text-muted">Loading RPC provider settings...</Card>
      ) : (
        <div className="grid gap-5">
          <Card className="p-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="font-semibold text-text">RPC Routing</h2>
              </div>
              {dirty ? <Badge variant="warning">Unsaved</Badge> : <Badge variant="success">Saved</Badge>}
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="block text-sm font-medium text-muted">
                Routing Mode
                <select
                  value={draft.routingMode}
                  onChange={(event) => updateDraft('routingMode', event.target.value as RpcRoutingMode)}
                  className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="SMART">Smart Routing (Recommended)</option>
                  <option value="MANUAL">Manual Routing</option>
                </select>
              </label>

              <label className="block text-sm font-medium text-muted">
                Preferred Provider
                <select
                  value={draft.preferredProvider ?? ''}
                  onChange={(event) => updateDraft('preferredProvider', (event.target.value || null) as RpcPreferredProvider | null)}
                  disabled={draft.routingMode !== 'MANUAL'}
                  className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Auto selected</option>
                  {configuredProviders.map((provider) => (
                    <option key={provider.provider} value={provider.provider}>{providerLabels[provider.provider]}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-start gap-3 rounded-lg border border-border bg-white/[0.03] p-4">
                <input
                  type="checkbox"
                  checked={draft.autoFailover}
                  onChange={(event) => updateDraft('autoFailover', event.target.checked)}
                  className="mt-1 h-4 w-4 accent-primary"
                />
                <span>
                  <span className="block text-sm font-medium text-text">Auto Failover</span>
                  <span className="mt-1 block text-sm text-muted">Switch to another healthy configured provider if the selected provider fails.</span>
                </span>
              </label>
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-5 flex items-center gap-3">
              <Radio className="h-5 w-5 text-accent" aria-hidden="true" />
              <h2 className="font-semibold text-text">Provider Performance</h2>
            </div>
            <div className="mb-4 rounded-lg border border-border bg-white/[0.03] p-4">
              <p className="text-xs uppercase text-muted">Current Active Provider</p>
              <p className="mt-2 text-lg font-semibold text-text">
                {payload.routing.currentActiveProvider ? providerLabels[payload.routing.currentActiveProvider] : 'None configured'}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {payload.routing.providers.map((provider) => (
                <div key={provider.provider} className="rounded-lg border border-border bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-text">{providerLabels[provider.provider]}</h3>
                      <p className="mt-1 text-sm text-muted">Latency: {formatLatency(provider.latency)}</p>
                    </div>
                    <Badge variant={!provider.configured ? 'default' : provider.healthy ? 'success' : 'danger'}>
                      {!provider.configured ? 'Not Configured' : provider.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-5 font-semibold text-text">Request Settings</h2>
            <div className="max-w-sm">
              <Input
                label="RPC Request Timeout"
                type="number"
                min={5}
                max={120}
                value={draft.rpcTimeoutSeconds}
                onChange={(event) => updateDraft('rpcTimeoutSeconds', Number(event.target.value))}
              />
              <p className="mt-2 text-sm text-muted">Seconds. Requests outside this window fail and may trigger failover.</p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
