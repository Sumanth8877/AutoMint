'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, ChevronRight, KeyRound, Lock, Palette, Radio, Settings, ShieldCheck, SlidersHorizontal, TestTube2, User, Wallet } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { apiRequest } from '@/lib/api/client';

const groups = [
  { title: 'General', icon: User, items: ['Profile', 'Appearance', 'Language'] },
  { title: 'Wallets', icon: Wallet, items: ['Connected Wallets', 'Default Wallet', 'Network Preferences'] },
  { title: 'RPC Providers', icon: Radio, items: ['Provider Settings', 'Gas Optimization', 'Timeout Settings'] },
  { title: 'Execution', icon: SlidersHorizontal, items: ['Mint Defaults', 'Retry Logic', 'Risk Gates'] },
  { title: 'Notifications', icon: Bell, items: ['Alert Preferences', 'Email Notifications', 'Push Notifications'] },
  { title: 'Security', icon: Lock, items: ['Two-Factor Auth', 'Session Management', 'API Keys'] },
];

const icons = [Palette, Wallet, Radio, ShieldCheck, Bell, KeyRound];
const API_KEYS_SETTING = 'Security: API Keys';

type IntegrationStatus = 'UNKNOWN' | 'PASS' | 'FAIL';

type IntegrationResult = {
  name: string;
  configured: boolean;
  source: 'Environment';
  status: IntegrationStatus;
  latency: number | null;
  error: string | null;
  lastTestedAt: string | null;
};

type IntegrationSummary = {
  healthyServices: number;
  failingServices: number;
  overallInfrastructureScore: number;
};

type IntegrationStatusResponse = {
  integrations: IntegrationResult[];
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

export default function SettingsPage() {
  const [activeSetting, setActiveSetting] = useState<string | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatusResponse | null>(null);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const isApiKeysOpen = activeSetting === API_KEYS_SETTING;
  const summary = integrationStatus?.summary;
  const totalServices = integrationStatus?.integrations.length ?? 0;
  const unknownServices = useMemo(() => {
    return integrationStatus?.integrations.filter((item) => item.status === 'UNKNOWN').length ?? 0;
  }, [integrationStatus]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function loadIntegrationStatus() {
    setLoadingIntegrations(true);
    setIntegrationStatus(null);

    try {
      const payload = await apiRequest<IntegrationStatusResponse>('/api/settings/integrations');
      setIntegrationStatus(payload);
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to load integration status.' });
    } finally {
      setLoadingIntegrations(false);
    }
  }

  async function testAllIntegrations() {
    setTesting(true);
    try {
      const payload = await apiRequest<IntegrationStatusResponse>('/api/settings/integrations', {
        method: 'POST',
      });
      setIntegrationStatus(payload);
      setToast({
        tone: payload.summary.failingServices === 0 ? 'success' : 'error',
        message: payload.summary.failingServices === 0 ? 'All integration tests passed.' : 'One or more integration tests failed.',
      });
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to test integrations.' });
    } finally {
      setTesting(false);
    }
  }

  function closeModal() {
    setActiveSetting(null);
  }

  function openSetting(setting: string) {
    setActiveSetting(setting);
    if (setting === API_KEYS_SETTING) {
      void loadIntegrationStatus();
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Configure preferences, risk controls, notification routing, wallet behavior, and API access."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group, index) => {
          const GroupIcon = group.icon;
          const ItemIcon = icons[index];

          return (
            <Card key={group.title} tone="interactive" className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                    <GroupIcon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <h2 className="font-semibold text-text">{group.title}</h2>
                </div>
                <Badge>{group.items.length} items</Badge>
              </div>
              <div className="divide-y divide-border">
                {group.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => openSetting(`${group.title}: ${item}`)}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-white/5"
                  >
                    <ItemIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                    <span className="text-sm font-medium text-text">{item}</span>
                    <ChevronRight className="ml-auto h-4 w-4 text-muted" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 p-5">
        <div className="flex items-center gap-3">
          <Settings className="h-5 w-5 text-accent" aria-hidden="true" />
          <p className="text-sm text-muted">Security-sensitive settings are verified from environment configuration on the server.</p>
        </div>
      </Card>

      <Modal open={Boolean(activeSetting)} title={isApiKeysOpen ? 'Integration Status' : activeSetting ?? 'Settings'} onClose={closeModal}>
        {isApiKeysOpen ? (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-background/60 p-3">
                <p className="text-[11px] uppercase text-muted">Healthy Services</p>
                <p className="mt-1 text-xl font-semibold text-text">{summary?.healthyServices ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border bg-background/60 p-3">
                <p className="text-[11px] uppercase text-muted">Failing Services</p>
                <p className="mt-1 text-xl font-semibold text-text">{summary?.failingServices ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border bg-background/60 p-3">
                <p className="text-[11px] uppercase text-muted">Score</p>
                <p className="mt-1 text-xl font-semibold text-text">{summary?.overallInfrastructureScore ?? 0}/100</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted">
                {loadingIntegrations ? 'Loading integration status...' : `${totalServices} services tracked / ${unknownServices} unknown`}
              </div>
              <Button type="button" variant="secondary" onClick={testAllIntegrations} loading={testing} disabled={loadingIntegrations}>
                <TestTube2 className="h-4 w-4" aria-hidden="true" />
                Test All Integrations
              </Button>
            </div>

            <div className="max-h-[58vh] overflow-auto rounded-lg border border-border">
              <table className="min-w-[780px] w-full text-left text-sm">
                <thead className="sticky top-0 border-b border-border bg-elevated text-xs uppercase text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Service</th>
                    <th className="px-4 py-3 font-medium">Configured</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Latency</th>
                    <th className="px-4 py-3 font-medium">Error Message</th>
                    <th className="px-4 py-3 font-medium">Last Tested Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {integrationStatus?.integrations.map((integration) => (
                    <tr key={integration.name}>
                      <td className="px-4 py-3 font-medium text-text">{integration.name}</td>
                      <td className="px-4 py-3">
                        <Badge variant={integration.configured ? 'success' : 'danger'}>{integration.configured ? 'YES' : 'NO'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">{integration.source}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusBadgeVariant(integration.status)}>{integration.status}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-muted">{integration.latency === null ? '-' : `${integration.latency}ms`}</td>
                      <td className="max-w-[260px] px-4 py-3 text-danger">{integration.error ?? '-'}</td>
                      <td className="px-4 py-3 text-muted">{formatTime(integration.lastTestedAt)}</td>
                    </tr>
                  )) ?? (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted" colSpan={7}>
                        {loadingIntegrations ? 'Loading integration status...' : 'No integration status loaded.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted">
              This settings area is not backed by a persistence endpoint yet. The action now opens intentionally instead of acting like a silent mutation.
            </p>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={closeModal}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {toast && (
        <div className={`fixed bottom-5 right-5 z-[60] rounded-lg border px-4 py-3 text-sm shadow-xl ${
          toast.tone === 'success'
            ? 'border-success/30 bg-success/15 text-success'
            : 'border-danger/30 bg-danger/15 text-danger'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
