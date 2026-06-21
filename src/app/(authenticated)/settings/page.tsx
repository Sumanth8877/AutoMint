'use client';

import { useEffect, useState } from 'react';
import { Bell, ChevronRight, KeyRound, Lock, Palette, Radio, Save, Settings, ShieldCheck, SlidersHorizontal, TestTube2, User, Wallet } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
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

type MaskedSetting = {
  configured: boolean;
  maskedValue: string | null;
};

type IntegrationSettingsResponse = {
  settings: {
    alchemyApiKey: MaskedSetting;
    quickNodeRpcUrl: MaskedSetting;
  };
};

type TestResult = {
  status: 'PASS' | 'FAIL';
  provider: string;
  currentBlock?: string;
  latency?: number;
  error?: string;
};

type TestResponse = {
  results: {
    alchemy: TestResult;
    quicknode: TestResult;
  };
};

export default function SettingsPage() {
  const [activeSetting, setActiveSetting] = useState<string | null>(null);
  const [settings, setSettings] = useState<IntegrationSettingsResponse['settings'] | null>(null);
  const [alchemyApiKey, setAlchemyApiKey] = useState('');
  const [quickNodeRpcUrl, setQuickNodeRpcUrl] = useState('');
  const [testResults, setTestResults] = useState<TestResponse['results'] | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const isApiKeysOpen = activeSetting === API_KEYS_SETTING;

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!isApiKeysOpen) return;

    let cancelled = false;
    apiRequest<IntegrationSettingsResponse>('/api/settings/integrations')
      .then((payload) => {
        if (!cancelled) setSettings(payload.settings);
      })
      .catch((error) => {
        if (!cancelled) setToast({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to load API keys.' });
      })
      .finally(() => {
        if (!cancelled) setLoadingSettings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isApiKeysOpen]);

  async function saveIntegrations() {
    setSaving(true);
    setTestResults(null);
    try {
      const payload = await apiRequest<IntegrationSettingsResponse>('/api/settings/integrations', {
        method: 'POST',
        body: {
          alchemyApiKey,
          quickNodeRpcUrl,
        },
      });
      setSettings(payload.settings);
      setAlchemyApiKey('');
      setQuickNodeRpcUrl('');
      setToast({ tone: 'success', message: 'Integration settings saved.' });
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to save integration settings.' });
    } finally {
      setSaving(false);
    }
  }

  async function testConnections() {
    setTesting(true);
    try {
      const payload = await apiRequest<TestResponse>('/api/settings/integrations', {
        method: 'POST',
        body: { action: 'test' },
      });
      setTestResults(payload.results);
      const passed = Object.values(payload.results).every((result) => result.status === 'PASS');
      setToast({ tone: passed ? 'success' : 'error', message: passed ? 'Connection tests passed.' : 'One or more connection tests failed.' });
    } catch (error) {
      setToast({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to test connections.' });
    } finally {
      setTesting(false);
    }
  }

  function closeModal() {
    setActiveSetting(null);
    setTestResults(null);
    setAlchemyApiKey('');
    setQuickNodeRpcUrl('');
  }

  function openSetting(setting: string) {
    setActiveSetting(setting);
    setTestResults(null);
    if (setting === API_KEYS_SETTING) {
      setLoadingSettings(true);
      setSettings(null);
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
          <p className="text-sm text-muted">Security-sensitive settings should be backed by server-side authorization checks, not navigation visibility alone.</p>
        </div>
      </Card>

      <Modal open={Boolean(activeSetting)} title={activeSetting ?? 'Settings'} onClose={closeModal}>
        {isApiKeysOpen ? (
          <div className="space-y-5">
            <div className="grid gap-4">
              <Input
                label="Alchemy API Key"
                type="password"
                value={alchemyApiKey}
                placeholder={settings?.alchemyApiKey.maskedValue ?? 'Not configured'}
                onChange={(event) => setAlchemyApiKey(event.target.value)}
                disabled={loadingSettings || saving || testing}
                autoComplete="off"
              />
              <Input
                label="QuickNode RPC URL"
                type="password"
                value={quickNodeRpcUrl}
                placeholder={settings?.quickNodeRpcUrl.maskedValue ?? 'Not configured'}
                onChange={(event) => setQuickNodeRpcUrl(event.target.value)}
                disabled={loadingSettings || saving || testing}
                autoComplete="off"
              />
            </div>

            {testResults && (
              <div className="grid gap-3 rounded-lg border border-border bg-background/60 p-4">
                {Object.values(testResults).map((result) => (
                  <div key={result.provider} className="flex flex-wrap items-center gap-3 text-sm">
                    <Badge variant={result.status === 'PASS' ? 'success' : 'danger'}>{result.status}</Badge>
                    <span className="font-medium text-text">{result.provider}</span>
                    {result.currentBlock && <span className="font-mono text-muted">Block {result.currentBlock}</span>}
                    {typeof result.latency === 'number' && <span className="font-mono text-muted">{result.latency}ms</span>}
                    {result.error && <span className="text-danger">{result.error}</span>}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <Button type="button" variant="secondary" onClick={testConnections} loading={testing} disabled={loadingSettings || saving}>
                <TestTube2 className="h-4 w-4" aria-hidden="true" />
                Test Connection
              </Button>
              <Button type="button" onClick={saveIntegrations} loading={saving} disabled={loadingSettings || testing}>
                <Save className="h-4 w-4" aria-hidden="true" />
                Save
              </Button>
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
