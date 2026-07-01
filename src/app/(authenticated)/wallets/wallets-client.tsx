'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, Edit3, ExternalLink, Plus, RefreshCw, Star, Trash2, Wallet } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api/client';
import type { WalletType } from '@/lib/wallets/detection';

type ImportWalletType = 'EVM' | 'SOLANA' | 'BITCOIN';

// H-3 fix: Arbitrum was added to chains.ts but never reflected here.
// Missing entry caused broken explorer links for all Arbitrum wallet addresses.
type Chain = 'ethereum' | 'base' | 'polygon' | 'arbitrum';
type SupportedWalletType = Exclude<WalletType, 'UNKNOWN'>;
type WalletTypeFilter = 'ALL' | SupportedWalletType;

type WalletRecord = {
  id: string;
  address: string;
  nickname: string | null;
  chain: Chain;
  walletType: WalletType;
  isDefault: boolean;
  pendingScheduledTasks: number;
  createdAt: string;
};

type BalanceRecord = {
  balance: string;
  symbol: string;
  updatedAt: string;
};

type WalletForm = {
  nickname: string;
  privateKey: string;
};

const explorerHosts: Record<Chain, string> = {
  ethereum: 'https://etherscan.io/address/',
  base:     'https://basescan.org/address/',
  polygon:  'https://polygonscan.com/address/',
  arbitrum: 'https://arbiscan.io/address/',
};

const typeExplorerHosts: Partial<Record<SupportedWalletType, string>> = {
  SOLANA: 'https://solscan.io/account/',
  BITCOIN: 'https://mempool.space/address/',
};

const walletTypeFilters: Array<{ value: WalletTypeFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'EVM', label: 'EVM' },
  { value: 'SOLANA', label: 'Solana' },
  { value: 'BITCOIN', label: 'Bitcoin' },
];

const chainOptions: Array<{ value: Chain; label: string }> = [
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'base',     label: 'Base' },
  { value: 'polygon',  label: 'Polygon' },
  { value: 'arbitrum', label: 'Arbitrum' },
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function chainLabel(chain: Chain) {
  return chainOptions.find((option) => option.value === chain)?.label ?? chain;
}

function walletName(wallet: WalletRecord) {
  return wallet.nickname || shortAddress(wallet.address);
}

function formatRelativeTime(value: string) {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (elapsedSeconds < 60) return 'just now';
  const minutes = Math.round(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatBalance(balance: BalanceRecord | undefined) {
  if (!balance) return 'Loading';
  const value = Number(balance.balance);
  const display = Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 4 })
    : balance.balance;
  return `${display} ${balance.symbol}`;
}

export default function WalletsClient() {
  const queryClient = useQueryClient();
  const [balances, setBalances] = useState<Record<string, BalanceRecord>>({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editWallet, setEditWallet] = useState<WalletRecord | null>(null);
  const [deleteWallet, setDeleteWallet] = useState<WalletRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Auto-dismiss success messages after 4 seconds
  useEffect(() => {
    if (!successMsg) return;
    const t = window.setTimeout(() => setSuccessMsg(null), 4000);
    return () => window.clearTimeout(t);
  }, [successMsg]);
  const [walletTypeFilter, setWalletTypeFilter] = useState<WalletTypeFilter>('ALL');
  const [form, setForm] = useState<WalletForm>({ nickname: '', privateKey: '' });
  const [importWalletType, setImportWalletType] = useState<ImportWalletType | null>(null);

  // Fetch wallets with React Query
  const { data: walletsData, isLoading, error: fetchError, refetch } = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<{ wallets: WalletRecord[] }>('/api/wallets'),
  });

  const wallets = useMemo(() => walletsData?.wallets ?? [], [walletsData?.wallets]);

  const filteredWallets = useMemo(() => {
    if (walletTypeFilter === 'ALL') return wallets;
    return wallets.filter((wallet) => wallet.walletType === walletTypeFilter);
  }, [walletTypeFilter, wallets]);

  const totalBalance = useMemo(() => {
    const balanceRows = Object.values(balances);
    if (balanceRows.length === 0) return '0 ETH';

    const symbolGroups = balanceRows.reduce<Record<string, number>>((groups, balance) => {
      const value = Number(balance.balance);
      if (!Number.isFinite(value)) return groups;
      return { ...groups, [balance.symbol]: (groups[balance.symbol] ?? 0) + value };
    }, {});

    const entries = Object.entries(symbolGroups);
    if (entries.length === 0) return '0 ETH';
    if (entries.length === 1) {
      const [symbol, value] = entries[0];
      return `${value.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${symbol}`;
    }
    return `${entries.length} networks`;
  }, [balances]);

  const refreshBalance = useCallback(async (wallet: WalletRecord, showErrors = true) => {
    if (wallet.walletType !== 'EVM') return;

    setRefreshingId(wallet.id);
    if (showErrors) setError(null);

    try {
      const payload = await apiRequest<{ balance: Omit<BalanceRecord, 'updatedAt'> }>(`/api/blockchain/balance?address=${encodeURIComponent(wallet.address)}&chain=${encodeURIComponent(wallet.chain)}`);
      setBalances((current) => ({
        ...current,
        [wallet.id]: { ...payload.balance, updatedAt: new Date().toISOString() },
      }));
    } catch (requestError) {
      if (showErrors) setError(requestError instanceof Error ? requestError.message : 'Failed to refresh balance.');
    } finally {
      setRefreshingId(null);
    }
  }, []);

  const refreshBalances = useCallback(async (walletRows: WalletRecord[]) => {
    await Promise.all(walletRows.filter((wallet) => wallet.walletType === 'EVM').map((wallet) => refreshBalance(wallet, false)));
  }, [refreshBalance]);

  // Refresh balances when wallets data changes
  useEffect(() => {
    if (wallets.length > 0) {
      void refreshBalances(wallets);
    }
  }, [wallets, refreshBalances]);

  // Set error from fetch error
  useEffect(() => {
    if (fetchError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors React Query fetch failures into local UI state
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load wallets.');
    }
  }, [fetchError]);

  function openAdd(walletType: ImportWalletType) {
    setForm({ nickname: '', privateKey: '' });
    setImportWalletType(walletType);
    setFormError(null);
    setAddModalOpen(true);
  }

  function openEdit(wallet: WalletRecord) {
    setForm({ nickname: wallet.nickname ?? '', privateKey: '' });
    setFormError(null);
    setEditWallet(wallet);
  }

  // Add wallet mutation
  const addWalletMutation = useMutation({
    mutationFn: async (walletData: { privateKey: string; nickname: string | null; walletType: ImportWalletType }) => {
      return apiRequest<{ wallet: WalletRecord }>('/api/wallets', {
        method: 'POST',
        body: walletData,
      });
    },
    onSuccess: (data) => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      if (data.wallet.walletType === 'EVM') void refreshBalance(data.wallet, false);
      setAddModalOpen(false);
      setForm({ nickname: '', privateKey: '' });
      setImportWalletType(null);
      setSuccessMsg(`Wallet ${data.wallet.nickname || shortAddress(data.wallet.address)} added`);
    },
    onError: (error) => {
      console.error('Error adding wallet:', error);
      setFormError(error instanceof Error ? error.message : 'Failed to add wallet.');
    },
  });

  // Edit wallet mutation
  const editWalletMutation = useMutation({
    mutationFn: async ({ id, nickname }: { id: string; nickname: string | null }) => {
      return apiRequest<{ wallet: WalletRecord }>(`/api/wallets/${id}`, {
        method: 'PATCH',
        body: { nickname },
      });
    },
    onSuccess: (data) => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      if (data.wallet.walletType === 'EVM') void refreshBalance(data.wallet, false);
      setEditWallet(null);
      setSuccessMsg('Wallet updated');
    },
  });

  // Set default wallet mutation — optimistic: flip isDefault immediately, rollback on error
  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<{ wallet: WalletRecord }>(`/api/wallets/${id}/default`, { method: 'PATCH' });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['wallets'] });
      const previous = queryClient.getQueryData<{ wallets: WalletRecord[] }>(['wallets']);
      queryClient.setQueryData<{ wallets: WalletRecord[] }>(['wallets'], (old) => ({
        wallets: (old?.wallets ?? []).map((w) => ({ ...w, isDefault: w.id === id })),
      }));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['wallets'], context.previous);
      setError('Failed to update default wallet.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      setSuccessMsg('Default wallet updated');
    },
  });

  // Delete wallet mutation — optimistic: remove from list immediately, rollback on error
  const deleteWalletMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<{ success: true }>(`/api/wallets/${id}`, { method: 'DELETE' });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['wallets'] });
      const previous = queryClient.getQueryData<{ wallets: WalletRecord[] }>(['wallets']);
      queryClient.setQueryData<{ wallets: WalletRecord[] }>(['wallets'], (old) => ({
        wallets: (old?.wallets ?? []).filter((w) => w.id !== id),
      }));
      setBalances((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['wallets'], context.previous);
      setError('Failed to remove wallet. It has been restored.');
    },
    onSettled: (_, _err, _id) => {
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
      setDeleteWallet(null);
      setBusyId(null);
      setSuccessMsg('Wallet removed');
    },
  });

  async function submitWallet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!importWalletType) {
      setFormError('Please select a wallet type');
      return;
    }

    addWalletMutation.mutate({
      privateKey: form.privateKey.trim(),
      nickname: form.nickname.trim() || null,
      walletType: importWalletType,
    });
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editWallet) return;
    setSaving(true);
    setFormError(null);

    try {
      await editWalletMutation.mutateAsync({
        id: editWallet.id,
        nickname: form.nickname.trim() || null,
      });
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to update wallet.');
    } finally {
      setSaving(false);
    }
  }

  async function setAsDefault(wallet: WalletRecord) {
    if (wallet.walletType !== 'EVM') {
      setError('Default wallet must be an EVM wallet.');
      return;
    }

    setBusyId(wallet.id);
    setError(null);

    try {
      await setDefaultMutation.mutateAsync(wallet.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to set default wallet.');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteWallet) return;
    setBusyId(deleteWallet.id);
    setError(null);

    try {
      await deleteWalletMutation.mutateAsync(deleteWallet.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to remove wallet.');
    } finally {
      setBusyId(null);
    }
  }

  async function copyAddress(wallet: WalletRecord) {
    try {
      await navigator.clipboard.writeText(wallet.address);
    } catch {
      setError('Clipboard access is unavailable in this browser.');
    }
  }

  function openExplorer(wallet: WalletRecord) {
    const host = wallet.walletType === 'EVM'
      ? explorerHosts[wallet.chain]
      : typeExplorerHosts[wallet.walletType as SupportedWalletType];

    if (!host) {
      setError(`No explorer configured for ${wallet.walletType}.`);
      return;
    }

    window.open(`${host}${wallet.address}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div>
      <PageHeader
        eyebrow="Capital"
        title="Wallets"
        description="Manage wallet names, defaults, balances, network coverage, and scheduled mint task assignment."
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => openAdd('EVM')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Import EVM
            </Button>
            <Button type="button" variant="secondary" onClick={() => openAdd('SOLANA')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Import Solana
            </Button>
            <Button type="button" variant="secondary" onClick={() => openAdd('BITCOIN')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Import Bitcoin
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Total Wallets" value={String(wallets.length)} detail="Connected to AutoMint" icon={Wallet} tone="success" />
        <MetricCard label="Total Balance" value={totalBalance} detail="Live EVM balances" icon={RefreshCw} tone="accent" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {walletTypeFilters.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => setWalletTypeFilter(filter.value)}
            className={`h-8 rounded-lg border px-3 text-xs font-medium transition ${
              walletTypeFilter === filter.value
                ? 'border-primary/40 bg-primary/15 text-text'
                : 'border-border bg-white/5 text-muted hover:text-text'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {successMsg ? (
        <div className="mt-6 rounded-lg border border-success/20 bg-success/10 p-3 text-sm text-success" role="status">
          {successMsg}
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {isLoading ? (
          [0, 1, 2].map((item) => (
            <Card key={item} className="p-5">
              <Skeleton className="h-6 w-56 bg-white/5" />
              <Skeleton className="mt-4 h-4 w-full bg-white/5" />
            </Card>
          ))
        ) : filteredWallets.length > 0 ? (
          filteredWallets.map((wallet) => {
            const balance = balances[wallet.id];

            return (
              <Card key={wallet.id} tone="interactive" className="p-5">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(120px,0.45fr))_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-text">{walletName(wallet)}</h2>
                      {wallet.isDefault ? <Badge variant="info">DEFAULT</Badge> : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-sm text-muted">{wallet.address}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase text-muted">Network</p>
                    <p className="mt-1 font-mono text-sm text-text">{wallet.walletType === 'EVM' ? `${wallet.walletType} / ${chainLabel(wallet.chain)}` : wallet.walletType}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase text-muted">Balance</p>
                    <p className="mt-1 font-mono text-sm text-text">{wallet.walletType === 'EVM' ? formatBalance(balance) : 'Unavailable'}</p>
                    <p className="mt-1 text-xs text-muted">{balance ? `Updated ${formatRelativeTime(balance.updatedAt)}` : wallet.walletType === 'EVM' ? 'Updated pending' : 'Updated unavailable'}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase text-muted">Pending Tasks</p>
                    <p className="mt-1 font-mono text-sm text-text">{wallet.pendingScheduledTasks}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase text-muted">Default</p>
                    <p className="mt-1 text-sm text-text">{wallet.isDefault ? 'Yes' : 'No'}</p>
                  </div>

                  <div className="flex flex-wrap gap-1 xl:justify-end">
                    <button type="button" onClick={() => openEdit(wallet)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text" aria-label={`Edit ${walletName(wallet)}`}>
                      <Edit3 className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => refreshBalance(wallet)} disabled={refreshingId === wallet.id || wallet.walletType !== 'EVM'} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text disabled:opacity-50" aria-label={`Refresh ${walletName(wallet)} balance`}>
                      <RefreshCw className={`h-4 w-4 ${refreshingId === wallet.id ? 'animate-spin' : ''}`} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setAsDefault(wallet)} disabled={wallet.isDefault || wallet.walletType !== 'EVM' || busyId === wallet.id} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-accent disabled:opacity-50" aria-label={`Set ${walletName(wallet)} as default`}>
                      <Star className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => copyAddress(wallet)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text" aria-label={`Copy ${walletName(wallet)} address`}>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => openExplorer(wallet)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text" aria-label={`Open ${walletName(wallet)} in explorer`}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => setDeleteWallet(wallet)} disabled={busyId === wallet.id} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-danger disabled:opacity-50" aria-label={`Remove ${walletName(wallet)}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })
        ) : wallets.length > 0 ? (
          <Card className="p-5">
            <p className="text-sm text-muted">No wallets match this filter.</p>
          </Card>
        ) : (
          <EmptyState
            icon={Wallet}
            title="No wallets connected."
            description="Add a wallet to make it available for mint planning, execution defaults, and balance checks."
          />
        )}
      </div>

      <Modal open={addModalOpen} title={`Add ${importWalletType === 'EVM' ? 'EVM' : importWalletType === 'SOLANA' ? 'Solana' : 'Bitcoin'} Wallet`} onClose={() => setAddModalOpen(false)}>
        <form onSubmit={submitWallet} className="space-y-4">
          <Input label="Wallet Name" value={form.nickname} onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))} placeholder="Main Wallet" />
          <Input
            label="Private Key"
            type="password"
            value={form.privateKey}
            onChange={(event) => setForm((current) => ({ ...current, privateKey: event.target.value }))}
            placeholder={
              importWalletType === 'EVM'
                ? '0x... (64 hex characters)'
                : importWalletType === 'SOLANA'
                  ? 'Base58 encoded or array format'
                  : 'Base58Check encoded or hex format'
            }
            required
          />
          <p className="text-xs text-muted">
            Importing {importWalletType === 'EVM' ? 'EVM (Ethereum, Base, Polygon)' : importWalletType === 'SOLANA' ? 'Solana' : 'Bitcoin'} wallet
          </p>
          {formError ? <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">{formError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAddModalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Add Wallet</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(editWallet)} title="Edit Wallet" onClose={() => setEditWallet(null)}>
        <form onSubmit={submitEdit} className="space-y-4">
          <Input
            label="Wallet Name"
            value={form.nickname}
            onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))}
            placeholder="Main Wallet"
          />
          <p className="text-xs text-muted">Wallet type: {editWallet?.walletType} | Chain: {editWallet?.chain}</p>
          {formError ? <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">{formError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditWallet(null)}>Cancel</Button>
            <Button type="submit" loading={saving}>Save Wallet</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(deleteWallet)} title="Remove Wallet" onClose={() => setDeleteWallet(null)}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Remove {deleteWallet ? walletName(deleteWallet) : 'this wallet'} from AutoMint?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeleteWallet(null)}>Cancel</Button>
            <Button type="button" variant="danger" loading={busyId === deleteWallet?.id} onClick={confirmDelete}>
              Remove
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
