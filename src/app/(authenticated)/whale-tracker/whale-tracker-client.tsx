'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Eye, Pause, Pencil, Play, Plus, Radar, ShieldCheck, Trash2, Zap } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Stagger, StaggerItem } from '@/components/motion';
import { apiRequest } from '@/lib/api/client';
import { isValidWalletAddress, walletAddressHint, sanitizeText, clampNumeric } from '@/lib/validation';

type NetworkType = 'EVM' | 'SOLANA' | 'BITCOIN';
type Chain = 'ethereum' | 'base' | 'polygon';

type TrackedWallet = {
  id: string;
  walletName: string | null;
  walletAddress: string;
  networkType: NetworkType;
  chain: Chain;
  active: boolean;
  reputationScore: number;
  copyMintStatus: 'enabled' | 'disabled' | 'none';
  lastActivityAt: string | null;
  createdAt: string;
};

type CopyRule = {
  id: string;
  walletAddress: string;
  maxPrice: string | null;
  quantity: number;
  riskThreshold: number;
  destinationWalletId: string | null;
  autoMint: boolean;
  enabled: boolean;
};

type DestinationWallet = {
  id: string;
  address: string;
  nickname: string | null;
};

type TrackerActivity = {
  id: string;
  collectionName: string;
  trackedWallet: string;
  time: string;
  riskScore: number | null;
  copied: boolean;
  copyStatus: string;
};

type Reputation = {
  id: string;
  walletAddress: string;
  reputationScore: number;
  totalMints: number;
  successfulProjects: number;
  failedProjects: number;
  rugProjects: number;
};

type WalletForm = {
  walletName: string;
  walletAddress: string;
  networkType: NetworkType;
};

type RuleForm = {
  walletAddress: string;
  autoMint: boolean;
  quantity: string;
  maxPrice: string;
  riskThreshold: string;
  destinationWalletId: string;
  enabled: boolean;
};

const networkOptions: Array<{ value: NetworkType; label: string }> = [
  { value: 'EVM', label: 'EVM' },
  { value: 'SOLANA', label: 'Solana' },
  { value: 'BITCOIN', label: 'Bitcoin' },
];

function shortAddress(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatRelativeTime(value: string | null) {
  if (!value) return 'No activity';
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (elapsedSeconds < 60) return 'just now';
  const minutes = Math.round(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function walletLabel(wallet: TrackedWallet) {
  return wallet.walletName || shortAddress(wallet.walletAddress);
}

function destinationLabel(wallet: DestinationWallet) {
  return wallet.nickname || shortAddress(wallet.address);
}

function accuracy(reputation: Reputation) {
  if (reputation.totalMints === 0) return '0%';
  return `${Math.round((reputation.successfulProjects / reputation.totalMints) * 100)}%`;
}

const emptyRuleForm: RuleForm = {
  walletAddress: '',
  autoMint: false,
  quantity: '1',
  maxPrice: '',
  riskThreshold: '75',
  destinationWalletId: '',
  enabled: true,
};

export default function WhaleTrackerClient() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [walletModal, setWalletModal] = useState<'add' | 'edit' | null>(null);
  const [editingWallet, setEditingWallet] = useState<TrackedWallet | null>(null);
  const [ruleModal, setRuleModal] = useState<'add' | 'edit' | null>(null);
  const [editingRule, setEditingRule] = useState<CopyRule | null>(null);
  const [walletForm, setWalletForm] = useState<WalletForm>({ walletName: '', walletAddress: '', networkType: 'EVM' });
  const [ruleForm, setRuleForm] = useState<RuleForm>(emptyRuleForm);

  // Fetch all data with React Query
  const { data: walletData, isLoading: walletsLoading } = useQuery({
    queryKey: ['watched-wallets'],
    queryFn: () => apiRequest<{ wallets: TrackedWallet[] }>('/api/watched-wallets'),
  });

  const { data: ruleData } = useQuery({
    queryKey: ['copy-mint-rules'],
    queryFn: () => apiRequest<{ rules: CopyRule[] }>('/api/copy-mint/rules'),
  });

  const { data: activityData } = useQuery({
    queryKey: ['whale-tracker-activity'],
    queryFn: () => apiRequest<{ activities: TrackerActivity[]; metrics: { detectedMints24h: number; copiedMints24h: number } }>('/api/whale-tracker/activity'),
  });

  const { data: reputationData } = useQuery({
    queryKey: ['wallet-reputation'],
    queryFn: () => apiRequest<{ reputations: Reputation[] }>('/api/wallet-reputation'),
  });

  const { data: destinationData } = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<{ wallets: DestinationWallet[] }>('/api/wallets'),
  });

  const trackedWallets = walletData?.wallets || [];
  const copyRules = useMemo(() => ruleData?.rules ?? [], [ruleData?.rules]);
  const activities = activityData?.activities || [];
  const reputations = reputationData?.reputations || [];
  const destinationWallets = destinationData?.wallets || [];
  const detectedMints24h = activityData?.metrics.detectedMints24h || 0;
  const copiedMints24h = activityData?.metrics.copiedMints24h || 0;

  const activeCopyRules = useMemo(() => copyRules.filter((rule) => rule.enabled).length, [copyRules]);

  // Add/edit tracked wallet mutation
  const walletMutation = useMutation({
    mutationFn: async (data: { walletName: string | null; walletAddress: string; networkType: NetworkType; id?: string }) => {
      if (data.id) {
        return apiRequest<{ wallet: TrackedWallet }>(`/api/watched-wallets/${data.id}`, {
          method: 'PATCH',
          body: { walletName: data.walletName, walletAddress: data.walletAddress, networkType: data.networkType },
        });
      } else {
        return apiRequest<{ wallet: TrackedWallet }>('/api/watched-wallets', {
          method: 'POST',
          body: { walletName: data.walletName, walletAddress: data.walletAddress, networkType: data.networkType },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watched-wallets'] });
    },
  });

  // Set tracking status mutation
  const trackingMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      return apiRequest<{ wallet: TrackedWallet }>(`/api/watched-wallets/${id}`, {
        method: 'PATCH',
        body: { active },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watched-wallets'] });
    },
  });

  // Delete wallet mutation
  const deleteWalletMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<{ success: true }>(`/api/watched-wallets/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watched-wallets'] });
    },
  });

  // Add/edit copy rule mutation
  const ruleMutation = useMutation({
    mutationFn: async (data: RuleForm & { id?: string }) => {
      if (data.id) {
        return apiRequest<{ rule: CopyRule }>(`/api/copy-mint/rules/${data.id}`, {
          method: 'PATCH',
          body: data,
        });
      } else {
        return apiRequest<{ rule: CopyRule }>('/api/copy-mint/rules', {
          method: 'POST',
          body: data,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copy-mint-rules'] });
    },
  });

  // Toggle rule status mutation
  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      return apiRequest<{ rule: CopyRule }>(`/api/copy-mint/rules/${id}`, {
        method: 'PATCH',
        body: { enabled },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copy-mint-rules'] });
    },
  });

  // Delete rule mutation
  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<{ success: true }>(`/api/copy-mint/rules/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copy-mint-rules'] });
    },
  });

  function openAddWallet() {
    setWalletForm({ walletName: '', walletAddress: '', networkType: 'EVM' });
    setEditingWallet(null);
    setFormError(null);
    setWalletModal('add');
  }

  function openEditWallet(wallet: TrackedWallet) {
    setWalletForm({ walletName: wallet.walletName ?? '', walletAddress: wallet.walletAddress, networkType: wallet.networkType });
    setEditingWallet(wallet);
    setFormError(null);
    setWalletModal('edit');
  }

  function openAddRule(walletAddress = '') {
    setRuleForm({ ...emptyRuleForm, walletAddress });
    setEditingRule(null);
    setFormError(null);
    setRuleModal('add');
  }

  function openEditRule(rule: CopyRule) {
    setRuleForm({
      walletAddress: rule.walletAddress,
      autoMint: rule.autoMint,
      quantity: String(rule.quantity),
      maxPrice: rule.maxPrice ?? '',
      riskThreshold: String(rule.riskThreshold),
      destinationWalletId: rule.destinationWalletId ?? '',
      enabled: rule.enabled,
    });
    setEditingRule(rule);
    setFormError(null);
    setRuleModal('edit');
  }

  async function submitWallet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const walletName = sanitizeText(walletForm.walletName);
    const walletAddress = walletForm.walletAddress.trim();

    if (!walletAddress) {
      setFormError('Wallet address is required.');
      return;
    }
    if (walletModal === 'add' && !isValidWalletAddress(walletAddress, walletForm.networkType)) {
      setFormError(walletAddressHint(walletForm.networkType));
      return;
    }

    setSaving(true);
    try {
      await walletMutation.mutateAsync({
        walletName: walletName || null,
        walletAddress,
        networkType: walletForm.networkType,
        id: walletModal === 'edit' ? editingWallet?.id : undefined,
      });
      setWalletModal(null);
      setWalletForm({ walletName: '', walletAddress: '', networkType: 'EVM' });
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to save tracked wallet.');
    } finally {
      setSaving(false);
    }
  }

  async function setTracking(wallet: TrackedWallet, active: boolean) {
    setBusyId(wallet.id);
    setError(null);

    try {
      await trackingMutation.mutateAsync({ id: wallet.id, active });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update tracking status.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteWallet(wallet: TrackedWallet) {
    setBusyId(wallet.id);
    setError(null);

    try {
      await deleteWalletMutation.mutateAsync(wallet.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete tracked wallet.');
    } finally {
      setBusyId(null);
    }
  }

  async function submitRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!ruleForm.walletAddress.trim()) {
      setFormError('Select a tracked wallet.');
      return;
    }
    const quantity = clampNumeric(ruleForm.quantity, 1, 1000);
    if (quantity === null || !Number.isInteger(quantity)) {
      setFormError('Max quantity must be a whole number of at least 1.');
      return;
    }
    if (ruleForm.maxPrice.trim()) {
      const maxPrice = clampNumeric(ruleForm.maxPrice, 0, Number.MAX_SAFE_INTEGER);
      if (maxPrice === null) {
        setFormError('Max spend must be a valid non-negative number.');
        return;
      }
    }
    const riskThreshold = clampNumeric(ruleForm.riskThreshold, 0, 100);
    if (riskThreshold === null) {
      setFormError('Risk threshold must be a number between 0 and 100.');
      return;
    }

    setSaving(true);

    const body = {
      walletAddress: ruleForm.walletAddress.trim(),
      autoMint: ruleForm.autoMint,
      quantity: String(quantity),
      maxPrice: ruleForm.maxPrice.trim() || null,
      riskThreshold: String(riskThreshold),
      destinationWalletId: ruleForm.destinationWalletId || null,
      enabled: ruleForm.enabled,
    };

    try {
      await ruleMutation.mutateAsync({
        ...body,
        maxPrice: body.maxPrice || '',
        destinationWalletId: body.destinationWalletId || '',
        id: ruleModal === 'edit' ? editingRule?.id : undefined,
      });
      setRuleModal(null);
      setRuleForm(emptyRuleForm);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to save copy rule.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: CopyRule, enabled: boolean) {
    setBusyId(rule.id);
    setError(null);

    try {
      await toggleRuleMutation.mutateAsync({ id: rule.id, enabled });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to update copy rule.');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRule(rule: CopyRule) {
    setBusyId(rule.id);
    setError(null);

    try {
      await deleteRuleMutation.mutateAsync(rule.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete copy rule.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Signals"
        title="Whale Tracker"
        description="Track high-signal wallets, control copy-mint rules, and review detected mint activity."
        actions={
          <Button type="button" onClick={openAddWallet}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Wallet
          </Button>
        }
      />

      <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" inView>
        <StaggerItem><MetricCard label="Tracked Wallets" value={trackedWallets.length} detail={`${trackedWallets.filter((wallet) => wallet.active).length} active`} icon={Eye} tone="accent" /></StaggerItem>
        <StaggerItem><MetricCard label="Active Copy Rules" value={activeCopyRules} detail={`${copyRules.length} configured`} icon={Zap} tone="success" /></StaggerItem>
        <StaggerItem><MetricCard label="Detected Mints (24h)" value={detectedMints24h} detail="From wallet activity" icon={Radar} tone="primary" /></StaggerItem>
        <StaggerItem><MetricCard label="Copied Mints (24h)" value={copiedMints24h} detail="Copy actions recorded" icon={Activity} tone="warning" /></StaggerItem>
      </Stagger>

      {error ? (
        <div className="mt-6 rounded-lg border border-danger/20 bg-red-50 p-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Tracked Wallets</h2>
          <Button type="button" variant="secondary" size="sm" onClick={openAddWallet}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Wallet
          </Button>
        </div>

        <Card className="overflow-hidden">
          {walletsLoading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((item) => <Skeleton key={item} className="h-16 w-full bg-surface-hover" />)}
            </div>
          ) : trackedWallets.length > 0 ? (
            <Stagger className="divide-y divide-border" stagger={0.05}>
              {trackedWallets.map((wallet) => (
                <StaggerItem key={wallet.id}>
                <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(120px,.45fr)_minmax(120px,.45fr)_minmax(120px,.45fr)_minmax(120px,.45fr)_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-text">{walletLabel(wallet)}</h3>
                      <Badge variant={wallet.active ? 'success' : 'warning'}>{wallet.active ? 'Tracking' : 'Paused'}</Badge>
                    </div>
                    <p className="mt-1 break-all font-mono text-sm text-muted">{wallet.walletAddress}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted">Network</p>
                    <p className="mt-1 text-sm text-text">{wallet.networkType}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted">Reputation Score</p>
                    <p className="mt-1 font-mono text-sm text-text">{wallet.reputationScore}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted">Copy Mint Status</p>
                    <Badge variant={wallet.copyMintStatus === 'enabled' ? 'success' : wallet.copyMintStatus === 'disabled' ? 'warning' : 'default'}>
                      {wallet.copyMintStatus}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-muted">Last Activity</p>
                    <p className="mt-1 text-sm text-text">{formatRelativeTime(wallet.lastActivityAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 xl:justify-end">
                    <button type="button" onClick={() => openEditWallet(wallet)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-text" aria-label="Edit tracked wallet">
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setTracking(wallet, !wallet.active)} disabled={busyId === wallet.id} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50" aria-label={wallet.active ? 'Pause tracking' : 'Resume tracking'}>
                      {wallet.active ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => openAddRule(wallet.walletAddress)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-primary" aria-label="Create copy mint rule">
                      <Zap className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => deleteWallet(wallet)} disabled={busyId === wallet.id} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-hover hover:text-danger disabled:opacity-50" aria-label="Delete tracked wallet">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                </StaggerItem>
              ))}
            </Stagger>
          ) : (
            <div className="p-5">
              <EmptyState
                icon={Eye}
                title="No tracked wallets."
                description="Add a wallet to start monitoring mint activity and configuring copy-mint rules."
                action={<Button type="button" onClick={openAddWallet}><Plus className="h-4 w-4" aria-hidden="true" />Add Wallet</Button>}
              />
            </div>
          )}
        </Card>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,.9fr)]">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-text">Copy Mint Rules</h2>
            <Button type="button" variant="secondary" size="sm" onClick={() => openAddRule()}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create Rule
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {walletsLoading ? (
              [0, 1].map((item) => <Skeleton key={item} className="h-24 w-full bg-surface-hover" />)
            ) : copyRules.length > 0 ? (
              <Stagger stagger={0.06}>
              {copyRules.map((rule) => {
                const wallet = trackedWallets.find((item) => item.walletAddress === rule.walletAddress);
                const destination = destinationWallets.find((item) => item.id === rule.destinationWalletId);

                return (
                  <StaggerItem key={rule.id}>
                  <div className="rounded-lg border border-border bg-surface-hover p-4 mb-3 last:mb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-text">{wallet ? walletLabel(wallet) : shortAddress(rule.walletAddress)}</p>
                        <p className="mt-1 break-all text-xs text-muted">{rule.walletAddress}</p>
                      </div>
                      <Badge variant={rule.enabled ? 'success' : 'warning'}>{rule.enabled ? 'Enabled' : 'Disabled'}</Badge>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div><p className="text-xs uppercase text-muted">Auto Copy Enabled</p><p className="mt-1 text-sm text-text">{rule.autoMint ? 'Yes' : 'No'}</p></div>
                      <div><p className="text-xs uppercase text-muted">Max Quantity</p><p className="mt-1 text-sm text-text">{rule.quantity}</p></div>
                      <div><p className="text-xs uppercase text-muted">Max Spend</p><p className="mt-1 text-sm text-text">{rule.maxPrice ?? 'No limit'}</p></div>
                      <div><p className="text-xs uppercase text-muted">Risk Threshold</p><p className="mt-1 text-sm text-text">{rule.riskThreshold}</p></div>
                      <div className="sm:col-span-2"><p className="text-xs uppercase text-muted">Destination Wallet</p><p className="mt-1 break-all text-sm text-text">{destination ? destinationLabel(destination) : 'Default execution wallet'}</p></div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" size="sm" onClick={() => openEditRule(rule)}>Edit</Button>
                      <Button type="button" variant="secondary" size="sm" loading={busyId === rule.id} onClick={() => toggleRule(rule, !rule.enabled)}>{rule.enabled ? 'Disable' : 'Enable'}</Button>
                      <Button type="button" variant="danger" size="sm" loading={busyId === rule.id} onClick={() => deleteRule(rule)}>Delete</Button>
                    </div>
                  </div>
                  </StaggerItem>
                );
              })}
              </Stagger>
            ) : (
              <EmptyState icon={Zap} title="No copy mint rules." description="Create a rule from a tracked wallet to record or execute copy-mint actions." action={<Button type="button" onClick={() => openAddRule()}><Plus className="h-4 w-4" aria-hidden="true" />Create Rule</Button>} />
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-lg font-semibold text-text">Reputation</h2>
          <div className="mt-4 space-y-3">
            {walletsLoading ? (
              [0, 1, 2].map((item) => <Skeleton key={item} className="h-20 w-full bg-surface-hover" />)
            ) : reputations.length > 0 ? (
              <Stagger stagger={0.06}>
              {reputations.map((reputation) => (
                <StaggerItem key={reputation.id}>
                <div className="rounded-lg border border-border bg-surface-hover p-4 mb-3 last:mb-0">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-success/20 bg-emerald-50 text-success">
                      <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-sm text-text">{reputation.walletAddress}</p>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div><p className="text-xs uppercase text-muted">Reputation Score</p><p className="font-mono text-text">{reputation.reputationScore}</p></div>
                        <div><p className="text-xs uppercase text-muted">Successful Calls</p><p className="font-mono text-text">{reputation.successfulProjects}</p></div>
                        <div><p className="text-xs uppercase text-muted">Failed Calls</p><p className="font-mono text-text">{reputation.failedProjects + reputation.rugProjects}</p></div>
                        <div><p className="text-xs uppercase text-muted">Accuracy</p><p className="font-mono text-text">{accuracy(reputation)}</p></div>
                      </div>
                    </div>
                  </div>
                </div>
                </StaggerItem>
              ))}
              </Stagger>
            ) : (
              <EmptyState icon={ShieldCheck} title="No reputation records." description="Reputation appears after tracked wallets produce copy-mint outcomes." />
            )}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-text">Detected Mint Activity</h2>
          <div className="mt-4 space-y-3">
            {walletsLoading ? (
              [0, 1, 2].map((item) => <Skeleton key={item} className="h-20 w-full bg-surface-hover" />)
            ) : activities.length > 0 ? (
              <Stagger stagger={0.05}>
              {activities.map((activityItem) => (
                <StaggerItem key={`${activityItem.id}-${activityItem.time}`}>
                <div className="grid gap-3 rounded-lg border border-border bg-surface-hover p-4 mb-3 last:mb-0 md:grid-cols-[minmax(0,1fr)_minmax(140px,.45fr)_minmax(100px,.35fr)_minmax(100px,.35fr)_minmax(120px,.45fr)] md:items-center">
                  <div className="min-w-0">
                    <p className="break-all font-semibold text-text">{activityItem.collectionName}</p>
                    <p className="mt-1 break-all text-xs text-muted">{activityItem.trackedWallet}</p>
                  </div>
                  <div><p className="text-xs uppercase text-muted">Time</p><p className="text-sm text-text">{formatRelativeTime(activityItem.time)}</p></div>
                  <div><p className="text-xs uppercase text-muted">Risk Score</p><p className="text-sm text-text">{activityItem.riskScore === null ? 'Not scored' : `Risk ${activityItem.riskScore}`}</p></div>
                  <div><p className="text-xs uppercase text-muted">Copied</p><p className="text-sm text-text">{activityItem.copied ? 'YES' : 'NO'}</p></div>
                  <div><p className="text-xs uppercase text-muted">Copy Status</p><p className="text-sm text-text">{activityItem.copyStatus}</p></div>
                </div>
                </StaggerItem>
              ))}
              </Stagger>
            ) : (
              <EmptyState icon={Activity} title="No detected mint activity." description="Detected mints appear after tracked wallet webhook activity is recorded." />
            )}
          </div>
        </Card>
      </section>

      <Modal open={walletModal !== null} title={walletModal === 'edit' ? 'Edit Tracked Wallet' : 'Add Tracked Wallet'} onClose={() => { setWalletModal(null); setFormError(null); }}>
        <form onSubmit={submitWallet} className="space-y-4">
          <Input label="Wallet Name" value={walletForm.walletName} onChange={(event) => setWalletForm((current) => ({ ...current, walletName: event.target.value }))} placeholder="Main Whale" />
          <Input label="Wallet Address" value={walletForm.walletAddress} onChange={(event) => setWalletForm((current) => ({ ...current, walletAddress: event.target.value }))} placeholder="0x, Solana, or Bitcoin address" disabled={walletModal === 'edit'} required hint={walletModal === 'add' ? walletAddressHint(walletForm.networkType) : undefined} />
          <label className="block text-sm font-medium text-muted">
            Network
            <select
              value={walletForm.networkType}
              onChange={(event) => setWalletForm((current) => ({ ...current, networkType: event.target.value as NetworkType }))}
              disabled={walletModal === 'edit'}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-surface/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            >
              {networkOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {formError ? <div className="rounded-lg border border-danger/20 bg-red-50 p-3 text-sm text-danger" role="alert">{formError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setWalletModal(null); setFormError(null); }}>Cancel</Button>
            <Button type="submit" loading={saving}>{walletModal === 'edit' ? 'Save Wallet' : 'Add Wallet'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={ruleModal !== null} title={ruleModal === 'edit' ? 'Edit Copy Mint Rule' : 'Create Copy Mint Rule'} onClose={() => { setRuleModal(null); setFormError(null); }}>
        <form onSubmit={submitRule} className="space-y-4">
          <label className="block text-sm font-medium text-muted">
            Tracked Wallet
            <select
              value={ruleForm.walletAddress}
              onChange={(event) => setRuleForm((current) => ({ ...current, walletAddress: event.target.value }))}
              disabled={ruleModal === 'edit'}
              required
              className="mt-2 h-11 w-full rounded-lg border border-border bg-surface/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
            >
              <option value="">Select tracked wallet</option>
              {trackedWallets.filter((wallet) => wallet.networkType === 'EVM').map((wallet) => (
                <option key={wallet.id} value={wallet.walletAddress}>{walletLabel(wallet)}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Max Quantity" type="number" min={1} value={ruleForm.quantity} onChange={(event) => setRuleForm((current) => ({ ...current, quantity: event.target.value }))} required />
            <Input label="Max Spend" type="number" min={0} step="0.0001" value={ruleForm.maxPrice} onChange={(event) => setRuleForm((current) => ({ ...current, maxPrice: event.target.value }))} placeholder="No limit" />
            <Input label="Risk Threshold" type="number" min={0} max={100} value={ruleForm.riskThreshold} onChange={(event) => setRuleForm((current) => ({ ...current, riskThreshold: event.target.value }))} required />
            <label className="block text-sm font-medium text-muted">
              Destination Wallet
              <select
                value={ruleForm.destinationWalletId}
                onChange={(event) => setRuleForm((current) => ({ ...current, destinationWalletId: event.target.value }))}
                className="mt-2 h-11 w-full rounded-lg border border-border bg-surface/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Default execution wallet</option>
                {destinationWallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{destinationLabel(wallet)}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
              <Checkbox
                checked={ruleForm.autoMint}
                onChange={() => setRuleForm((current) => ({ ...current, autoMint: !current.autoMint }))}
              />
              Auto Copy Enabled
            </label>
            <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
              <Checkbox
                checked={ruleForm.enabled}
                onChange={() => setRuleForm((current) => ({ ...current, enabled: !current.enabled }))}
              />
              Rule Enabled
            </label>
          </div>
          {formError ? <div className="rounded-lg border border-danger/20 bg-red-50 p-3 text-sm text-danger" role="alert">{formError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setRuleModal(null); setFormError(null); }}>Cancel</Button>
            <Button type="submit" loading={saving}>{ruleModal === 'edit' ? 'Save Rule' : 'Create Rule'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
