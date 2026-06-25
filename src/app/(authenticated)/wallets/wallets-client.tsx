'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

type Chain = 'ethereum' | 'base' | 'polygon';
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
  address: string;
  chain: Chain;
};

const explorerHosts: Record<Chain, string> = {
  ethereum: 'https://etherscan.io/address/',
  base: 'https://basescan.org/address/',
  polygon: 'https://polygonscan.com/address/',
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
  { value: 'base', label: 'Base' },
  { value: 'polygon', label: 'Polygon' },
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
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [balances, setBalances] = useState<Record<string, BalanceRecord>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editWallet, setEditWallet] = useState<WalletRecord | null>(null);
  const [deleteWallet, setDeleteWallet] = useState<WalletRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [walletTypeFilter, setWalletTypeFilter] = useState<WalletTypeFilter>('ALL');
  const [form, setForm] = useState<WalletForm>({ nickname: '', address: '', chain: 'ethereum' });

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

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const payload = await apiRequest<{ wallets: WalletRecord[] }>('/api/wallets');
        if (!active) return;
        setWallets(payload.wallets);
        void refreshBalances(payload.wallets);
      } catch (requestError) {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load wallets.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, [refreshBalances]);

  function openAdd() {
    setForm({ nickname: '', address: '', chain: 'ethereum' });
    setFormError(null);
    setAddModalOpen(true);
  }

  function openEdit(wallet: WalletRecord) {
    setForm({ nickname: wallet.nickname ?? '', address: wallet.address, chain: wallet.chain });
    setFormError(null);
    setEditWallet(wallet);
  }

  async function submitWallet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      const payload = await apiRequest<{ wallet: WalletRecord }>('/api/wallets', {
        method: 'POST',
        body: {
          address: form.address.trim(),
          nickname: form.nickname.trim() || null,
          chain: form.chain,
        },
      });

      setWallets((current) => [...current, payload.wallet]);
      if (payload.wallet.walletType === 'EVM') void refreshBalance(payload.wallet, false);
      setAddModalOpen(false);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to add wallet.');
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editWallet) return;
    setSaving(true);
    setFormError(null);

    try {
      const payload = await apiRequest<{ wallet: WalletRecord }>(`/api/wallets/${editWallet.id}`, {
        method: 'PATCH',
        body: {
          nickname: form.nickname.trim() || null,
          chain: form.chain,
        },
      });

      setWallets((current) => current.map((wallet) => wallet.id === payload.wallet.id ? { ...wallet, ...payload.wallet } : wallet));
      if (payload.wallet.walletType === 'EVM') void refreshBalance(payload.wallet, false);
      setEditWallet(null);
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
      const payload = await apiRequest<{ wallet: WalletRecord }>(`/api/wallets/${wallet.id}/default`, { method: 'PATCH' });
      setWallets((current) => current.map((item) => ({ ...item, isDefault: item.id === payload.wallet.id })));
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
      await apiRequest<{ success: true }>(`/api/wallets/${deleteWallet.id}`, { method: 'DELETE' });
      setWallets((current) => current.filter((wallet) => wallet.id !== deleteWallet.id));
      setBalances((current) => {
        const next = { ...current };
        delete next[deleteWallet.id];
        return next;
      });
      setDeleteWallet(null);
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
          <Button type="button" onClick={openAdd}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Wallet
          </Button>
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

      {error ? (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4">
        {loading ? (
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
            action={
              <Button type="button" onClick={openAdd}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Wallet
              </Button>
            }
          />
        )}
      </div>

      <Modal open={addModalOpen} title="Add Wallet" onClose={() => setAddModalOpen(false)}>
        <form onSubmit={submitWallet} className="space-y-4">
          <Input label="Wallet Name" value={form.nickname} onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))} placeholder="Main Wallet" />
          <Input label="Wallet Address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="0x, Solana, or Bitcoin address" required />
          <label className="block text-sm font-medium text-muted">
            EVM Network
            <select
              value={form.chain}
              onChange={(event) => setForm((current) => ({ ...current, chain: event.target.value as Chain }))}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {chainOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
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
          {editWallet?.walletType === 'EVM' ? (
            <label className="block text-sm font-medium text-muted">
              EVM Network
              <select
                value={form.chain}
                onChange={(event) => setForm((current) => ({ ...current, chain: event.target.value as Chain }))}
                className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {chainOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          ) : null}
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
