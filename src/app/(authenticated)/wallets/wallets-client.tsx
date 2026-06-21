'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, Plus, RefreshCw, ShieldCheck, Trash2, Wallet } from 'lucide-react';
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

type WalletRecord = {
  id: string;
  address: string;
  nickname: string | null;
  chain: string;
  walletType: WalletType;
  isDefault: boolean;
  createdAt: string;
};

type BalanceRecord = {
  balance: string;
  symbol: string;
};

const explorerHosts: Record<string, string> = {
  ethereum: 'https://etherscan.io/address/',
  base: 'https://basescan.org/address/',
  polygon: 'https://polygonscan.com/address/',
};

const typeExplorerHosts: Partial<Record<WalletType, string>> = {
  SOLANA: 'https://solscan.io/account/',
  BITCOIN: 'https://mempool.space/address/',
};

const walletTypeFilters: Array<{ value: 'ALL' | WalletType; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'EVM', label: 'EVM' },
  { value: 'SOLANA', label: 'Solana' },
  { value: 'BITCOIN', label: 'Bitcoin' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function WalletsClient() {
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [balances, setBalances] = useState<Record<string, BalanceRecord>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ nickname: '', address: '', chain: 'ethereum', walletTypeOverride: '' });
  const [walletTypeFilter, setWalletTypeFilter] = useState<'ALL' | WalletType>('ALL');

  const readyCount = useMemo(() => wallets.length, [wallets.length]);
  const filteredWallets = useMemo(() => {
    if (walletTypeFilter === 'ALL') return wallets;
    return wallets.filter((wallet) => wallet.walletType === walletTypeFilter);
  }, [walletTypeFilter, wallets]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const payload = await apiRequest<{ wallets: WalletRecord[] }>('/api/wallets');
        if (!active) return;
        setWallets(payload.wallets);
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
  }, []);

  const refreshBalance = async (wallet: WalletRecord) => {
    if (wallet.walletType !== 'EVM') {
      setError('Balance refresh is currently available for EVM wallets only.');
      return;
    }

    setRefreshingId(wallet.id);
    setError(null);

    try {
      const payload = await apiRequest<{ balance: BalanceRecord }>(`/api/blockchain/balance?address=${encodeURIComponent(wallet.address)}&chain=${encodeURIComponent(wallet.chain)}`);
      setBalances((current) => ({ ...current, [wallet.id]: payload.balance }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to refresh balance.');
    } finally {
      setRefreshingId(null);
    }
  };

  const submitWallet = async (event: React.FormEvent<HTMLFormElement>) => {
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
          walletTypeOverride: form.walletTypeOverride || null,
        },
      });

      setWallets((current) => [...current, payload.wallet]);
      setForm({ nickname: '', address: '', chain: 'ethereum', walletTypeOverride: '' });
      setModalOpen(false);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to add wallet.');
    } finally {
      setSaving(false);
    }
  };

  const deleteWallet = async (wallet: WalletRecord) => {
    setDeletingId(wallet.id);
    setError(null);

    try {
      await apiRequest<{ success: true }>('/api/wallets', { method: 'DELETE', body: { id: wallet.id } });
      setWallets((current) => current.filter((item) => item.id !== wallet.id));
      setBalances((current) => {
        const next = { ...current };
        delete next[wallet.id];
        return next;
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete wallet.');
    } finally {
      setDeletingId(null);
    }
  };

  const copyAddress = async (wallet: WalletRecord) => {
    try {
      await navigator.clipboard.writeText(wallet.address);
    } catch {
      setError('Clipboard access is unavailable in this browser.');
    }
  };

  const openExplorer = (wallet: WalletRecord) => {
    const host = wallet.walletType === 'EVM' ? explorerHosts[wallet.chain] : typeExplorerHosts[wallet.walletType];
    if (!host) {
      setError(`No explorer configured for ${wallet.walletType}.`);
      return;
    }

    window.open(`${host}${wallet.address}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div>
      <PageHeader
        eyebrow="Capital"
        title="Wallets"
        description="Track wallet funding, network coverage, exposure caps, nonce health, and readiness for automated minting."
        actions={
          <Button type="button" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Wallet
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Wallets" value={String(wallets.length)} detail="Loaded from your workspace" icon={Wallet} tone="success" />
        <MetricCard label="Ready Wallets" value={String(readyCount)} detail="Available for mint tasks" icon={ShieldCheck} tone="accent" />
        <MetricCard label="Balances" value={String(Object.keys(balances).length)} detail="Refreshed this session" icon={RefreshCw} tone="warning" />
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
              <Skeleton className="h-6 w-56" />
              <Skeleton className="mt-4 h-4 w-full" />
            </Card>
          ))
        ) : filteredWallets.length > 0 ? (
          filteredWallets.map((wallet) => {
            const balance = balances[wallet.id];

            return (
              <Card key={wallet.id} tone="interactive" className="p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-accent/20 bg-accent/10 text-accent">
                    <Wallet className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-text">{wallet.nickname || shortAddress(wallet.address)}</h2>
                      <Badge variant="success">Ready</Badge>
                      <Badge variant="info">{wallet.walletType}</Badge>
                      {wallet.isDefault ? <Badge>DEFAULT</Badge> : null}
                      {wallet.walletType === 'EVM' ? <Badge>{wallet.chain}</Badge> : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-sm text-muted">{wallet.address}</p>
                  </div>
                  <p className="font-mono text-lg text-text">{balance ? `${balance.balance} ${balance.symbol}` : 'Not refreshed'}</p>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => copyAddress(wallet)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text" aria-label={`Copy ${wallet.address}`}>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => refreshBalance(wallet)} disabled={refreshingId === wallet.id || wallet.walletType !== 'EVM'} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text disabled:opacity-50" aria-label={`Refresh ${wallet.address}`}>
                      <RefreshCw className={`h-4 w-4 ${refreshingId === wallet.id ? 'animate-spin' : ''}`} aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => openExplorer(wallet)} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text" aria-label={`Open ${wallet.address}`}>
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => deleteWallet(wallet)} disabled={deletingId === wallet.id} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-danger disabled:opacity-50" aria-label={`Delete ${wallet.address}`}>
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
            icon={AlertTriangle}
            title="No wallets yet"
            description="Add a wallet address to make it available for mint planning and balance checks."
            action={
              <Button type="button" onClick={() => setModalOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Wallet
              </Button>
            }
          />
        )}
      </div>

      <Modal open={modalOpen} title="Add Wallet" onClose={() => setModalOpen(false)}>
        <form onSubmit={submitWallet} className="space-y-4">
          <Input label="Nickname" value={form.nickname} onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))} placeholder="Primary Mint" />
          <Input label="Address" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="0x, Solana, or Bitcoin address" required />
          <label className="block text-sm font-medium text-muted">
            Wallet Type Override
            <select
              value={form.walletTypeOverride}
              onChange={(event) => setForm((current) => ({ ...current, walletTypeOverride: event.target.value }))}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Automatic detection</option>
              <option value="UNKNOWN">Unknown</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-muted">
            EVM Network
            <select
              value={form.chain}
              onChange={(event) => setForm((current) => ({ ...current, chain: event.target.value }))}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="ethereum">Ethereum</option>
              <option value="base">Base</option>
              <option value="polygon">Polygon</option>
            </select>
          </label>
          {formError ? <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">{formError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Add Wallet</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
