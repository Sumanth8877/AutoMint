'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Edit3, Star, Trash2, Wallet } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { apiRequest } from '@/lib/api/client';
import type { WalletType } from '@/lib/wallets/detection';

type WalletRecord = {
  id: string;
  address: string;
  nickname: string | null;
  chain: 'ethereum' | 'base' | 'polygon';
  walletType: WalletType;
  isDefault: boolean;
  createdAt: string;
};

type WalletForm = {
  nickname: string;
  chain: WalletRecord['chain'];
};

type WalletTypeFilter = 'ALL' | WalletType;

const chainOptions: Array<{ value: WalletRecord['chain']; label: string }> = [
  { value: 'ethereum', label: 'Ethereum' },
  { value: 'base', label: 'Base' },
  { value: 'polygon', label: 'Polygon' },
];

const walletTypeFilters: Array<{ value: WalletTypeFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'EVM', label: 'EVM' },
  { value: 'SOLANA', label: 'Solana' },
  { value: 'BITCOIN', label: 'Bitcoin' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function chainLabel(chain: string) {
  return chainOptions.find((item) => item.value === chain)?.label ?? chain;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

export default function ConnectedWalletsClient() {
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editWallet, setEditWallet] = useState<WalletRecord | null>(null);
  const [deleteWallet, setDeleteWallet] = useState<WalletRecord | null>(null);
  const [walletTypeFilter, setWalletTypeFilter] = useState<WalletTypeFilter>('ALL');
  const [form, setForm] = useState<WalletForm>({ nickname: '', chain: 'ethereum' });

  const defaultWallet = useMemo(() => wallets.find((wallet) => wallet.isDefault) ?? null, [wallets]);
  const filteredWallets = useMemo(() => {
    if (walletTypeFilter === 'ALL') return wallets;
    return wallets.filter((wallet) => wallet.walletType === walletTypeFilter);
  }, [walletTypeFilter, wallets]);

  useEffect(() => {
    let active = true;

    apiRequest<{ wallets: WalletRecord[] }>('/api/settings/wallets', {
      cache: 'no-store',
    })
      .then((payload) => {
        if (!active) return;
        setWallets(payload.wallets);
        setError(null);
      })
      .catch((requestError) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load wallets.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function openEdit(wallet: WalletRecord) {
    setForm({
      nickname: wallet.nickname ?? '',
      chain: wallet.chain,
    });
    setFormError(null);
    setEditWallet(wallet);
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editWallet) return;
    setSaving(true);
    setFormError(null);

    try {
      const payload = await apiRequest<{ wallet: WalletRecord }>(`/api/settings/wallets/${editWallet.id}`, {
        method: 'PATCH',
        body: {
          nickname: form.nickname.trim() || null,
          chain: form.chain,
        },
      });

      setWallets((current) => current.map((wallet) => wallet.id === payload.wallet.id ? payload.wallet : wallet));
      setEditWallet(null);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to update wallet.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteWallet) return;
    setBusyId(deleteWallet.id);
    setError(null);

    try {
      await apiRequest<{ success: true }>(`/api/settings/wallets/${deleteWallet.id}`, {
        method: 'DELETE',
      });
      setWallets((current) => current.filter((wallet) => wallet.id !== deleteWallet.id));
      setDeleteWallet(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete wallet.');
    } finally {
      setBusyId(null);
    }
  }

  async function setAsDefault(wallet: WalletRecord) {
    setBusyId(wallet.id);
    setError(null);

    try {
      const payload = await apiRequest<{ wallet: WalletRecord }>(`/api/settings/wallets/${wallet.id}/default`, {
        method: 'PATCH',
      });
      setWallets((current) => current.map((item) => ({ ...item, isDefault: item.id === payload.wallet.id })));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to set default wallet.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/settings" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Settings
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-text sm:text-3xl">Connected Wallets</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          View wallet ecosystems, defaults, and wallet settings already connected through the Wallets module.
        </p>
      </div>

      {error ? (
        <div className="mb-6 rounded-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-semibold text-text">Wallets</h2>
            <p className="mt-1 text-sm text-muted">
              {defaultWallet ? `${defaultWallet.nickname || shortAddress(defaultWallet.address)} is default` : 'No default wallet selected'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
        </div>

        {loading ? (
          <div className="p-8 text-sm text-muted">Loading wallets...</div>
        ) : wallets.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Wallet}
              title="No wallets connected yet."
              description="Add wallets from the Wallets module to manage them here."
            />
          </div>
        ) : filteredWallets.length === 0 ? (
          <div className="p-8 text-sm text-muted">No wallets match this filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="border-b border-border bg-white/5 text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Wallet Name</th>
                  <th className="px-4 py-3 font-medium">Wallet Address</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Chain</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created Date</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredWallets.map((wallet) => (
                  <tr key={wallet.id}>
                    <td className="px-4 py-4 font-medium text-text">{wallet.nickname || shortAddress(wallet.address)}</td>
                    <td className="px-4 py-4 font-mono text-muted">{wallet.address}</td>
                    <td className="px-4 py-4"><Badge variant="info">{wallet.walletType}</Badge></td>
                    <td className="px-4 py-4 text-text">{wallet.walletType === 'EVM' ? chainLabel(wallet.chain) : '-'}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="success">ACTIVE</Badge>
                        {wallet.isDefault ? <Badge variant="info">DEFAULT</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-muted">{formatDate(wallet.createdAt)}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => openEdit(wallet)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text" aria-label={`Edit ${wallet.nickname || wallet.address}`}>
                          <Edit3 className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => setAsDefault(wallet)} disabled={wallet.isDefault || busyId === wallet.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-accent disabled:opacity-50" aria-label={`Set ${wallet.nickname || wallet.address} as default`}>
                          <Star className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => setDeleteWallet(wallet)} disabled={busyId === wallet.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-danger disabled:opacity-50" aria-label={`Delete ${wallet.nickname || wallet.address}`}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
              Chain
              <select
                value={form.chain}
                onChange={(event) => setForm((current) => ({ ...current, chain: event.target.value as WalletRecord['chain'] }))}
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

      <Modal open={Boolean(deleteWallet)} title="Delete Wallet" onClose={() => setDeleteWallet(null)}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Remove {deleteWallet?.nickname || (deleteWallet ? shortAddress(deleteWallet.address) : 'this wallet')} from AutoMint?
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeleteWallet(null)}>Cancel</Button>
            <Button type="button" variant="danger" loading={busyId === deleteWallet?.id} onClick={confirmDelete}>
              Delete Wallet
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
