'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, SlidersHorizontal } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { apiRequest } from '@/lib/api/client';
import type { GasStrategy } from '@/lib/services/execution-settings.service';

type WalletRecord = {
  id: string;
  address: string;
  nickname: string | null;
  chain: string;
  isDefault: boolean;
};

type ExecutionSettings = {
  id: string;
  defaultMintQuantity: number;
  defaultWalletId: string | null;
  gasStrategy: GasStrategy;
  maxRetries: number;
  riskThreshold: number;
  autoRunAnalyzer: boolean;
  autoDetectSocials: boolean;
  autoDetectContractInfo: boolean;
  autoDetectMintDetails: boolean;
  riskAnalysisEnabled: boolean;
  aiSummaryEnabled: boolean;
  updatedAt: string;
};

type ExecutionPayload = {
  settings: ExecutionSettings;
  wallets: WalletRecord[];
  currentDefaultWalletId: string | null;
};

const gasStrategies: GasStrategy[] = ['STANDARD', 'FAST', 'AGGRESSIVE'];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function settingKey(settings: ExecutionSettings | null) {
  if (!settings) return '';
  return JSON.stringify({
    defaultMintQuantity: settings.defaultMintQuantity,
    defaultWalletId: settings.defaultWalletId,
    gasStrategy: settings.gasStrategy,
    maxRetries: settings.maxRetries,
    riskThreshold: settings.riskThreshold,
    autoRunAnalyzer: settings.autoRunAnalyzer,
    autoDetectSocials: settings.autoDetectSocials,
    autoDetectContractInfo: settings.autoDetectContractInfo,
    autoDetectMintDetails: settings.autoDetectMintDetails,
    riskAnalysisEnabled: settings.riskAnalysisEnabled,
    aiSummaryEnabled: settings.aiSummaryEnabled,
  });
}

export default function ExecutionSettingsClient() {
  const [payload, setPayload] = useState<ExecutionPayload | null>(null);
  const [draft, setDraft] = useState<ExecutionSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const dirty = useMemo(() => settingKey(payload?.settings ?? null) !== settingKey(draft), [draft, payload]);

  useEffect(() => {
    let active = true;

    apiRequest<ExecutionPayload>('/api/settings/execution', { cache: 'no-store' })
      .then((response) => {
        if (!active) return;
        setPayload(response);
        setDraft(response.settings);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load execution settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function updateDraft<K extends keyof ExecutionSettings>(key: K, value: ExecutionSettings[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setSuccess(null);
  }

  async function saveSettings() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiRequest<ExecutionPayload>('/api/settings/execution', {
        method: 'PATCH',
        cache: 'no-store',
        body: draft,
      });
      setPayload(response);
      setDraft(response.settings);
      setSuccess('Execution settings saved.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to save execution settings.');
    } finally {
      setSaving(false);
    }
  }

  function renderToggle(key: keyof ExecutionSettings, label: string, description: string) {
    const checked = Boolean(draft?.[key]);

    return (
      <label className="flex items-start gap-3 rounded-lg border border-border bg-white/[0.03] p-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => updateDraft(key, event.target.checked as never)}
          className="mt-1 h-4 w-4 accent-primary"
        />
        <span>
          <span className="block text-sm font-medium text-text">{label}</span>
          <span className="mt-1 block text-sm text-muted">{description}</span>
        </span>
      </label>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Link href="/settings" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Settings
          </Link>
          <h1 className="mt-3 text-2xl font-semibold text-text sm:text-3xl">Execution Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            User-level defaults for mint creation, execution behavior, and analyzer automation.
          </p>
        </div>
        <Button type="button" onClick={saveSettings} loading={saving} disabled={loading || !draft || !dirty}>
          <Save className="h-4 w-4" aria-hidden="true" />
          Save Settings
        </Button>
      </div>

      {error ? <div className="mb-6 rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">{error}</div> : null}
      {success ? <div className="mb-6 rounded-lg border border-success/25 bg-success/10 px-4 py-3 text-sm text-success" role="status">{success}</div> : null}

      {loading || !draft ? (
        <Card className="p-6 text-sm text-muted">Loading execution settings...</Card>
      ) : (
        <div className="grid gap-5">
          <Card className="p-5">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="h-5 w-5 text-accent" aria-hidden="true" />
                <h2 className="font-semibold text-text">Mint Defaults</h2>
              </div>
              {dirty ? <Badge variant="warning">Unsaved</Badge> : <Badge variant="success">Saved</Badge>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input
                label="Default Mint Quantity"
                type="number"
                min={1}
                max={100}
                value={draft.defaultMintQuantity}
                onChange={(event) => updateDraft('defaultMintQuantity', Number(event.target.value))}
              />
              <label className="block text-sm font-medium text-muted">
                Default Wallet
                <select
                  value={draft.defaultWalletId ?? ''}
                  onChange={(event) => updateDraft('defaultWalletId', event.target.value || null)}
                  className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">No default wallet</option>
                  {payload?.wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.nickname || shortAddress(wallet.address)} / {wallet.chain}{wallet.id === payload.currentDefaultWalletId ? ' / current default' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-5 font-semibold text-text">Execution Behavior</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="block text-sm font-medium text-muted">
                Gas Strategy
                <select
                  value={draft.gasStrategy}
                  onChange={(event) => updateDraft('gasStrategy', event.target.value as GasStrategy)}
                  className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  {gasStrategies.map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}
                </select>
              </label>
              <Input
                label="Maximum Retry Attempts"
                type="number"
                min={0}
                max={100}
                value={draft.maxRetries}
                onChange={(event) => updateDraft('maxRetries', Number(event.target.value))}
              />
              <Input
                label="Skip Mint If Risk Score Exceeds"
                type="number"
                min={0}
                max={100}
                value={draft.riskThreshold}
                onChange={(event) => updateDraft('riskThreshold', Number(event.target.value))}
              />
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-5 font-semibold text-text">Analyzer Preferences</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {renderToggle('autoRunAnalyzer', 'Auto Run Analyzer', 'Automatically run analyzer when collections are discovered.')}
              {renderToggle('autoDetectSocials', 'Auto Detect Socials', 'Collect Twitter/X, Discord, Telegram, and website links.')}
              {renderToggle('autoDetectContractInfo', 'Auto Detect Contract Information', 'Collect contract address, chain, and collection metadata.')}
              {renderToggle('autoDetectMintDetails', 'Auto Detect Mint Details', 'Collect mint price, supply, mint timing, and sale status.')}
              {renderToggle('riskAnalysisEnabled', 'Risk Analysis', 'Run the existing risk analysis workflow.')}
              {renderToggle('aiSummaryEnabled', 'AI Collection Summary', 'Generate collection summary when analyzer data is available.')}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
