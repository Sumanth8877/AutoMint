'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, MoreHorizontal, Play, Plus, RotateCcw, ShieldCheck, Trash2, XCircle, Zap } from 'lucide-react';
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

type MintTask = {
  id: string;
  walletId: string | null;
  collectionId: string | null;
  quantity: number;
  status: string;
  contractAddress: string | null;
  mintPrice: string | null;
  createdAt: string;
};

type WalletRecord = {
  id: string;
  address: string;
  nickname: string | null;
  chain: string;
};

type CollectionRecord = {
  id: string;
  name: string | null;
  contractAddress: string;
  chain: string;
};

type MintActionResponse = {
  task: MintTask;
  result?: {
    success: boolean;
    txHash?: string;
    error?: string;
  };
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function statusVariant(status: string) {
  if (status === 'completed' || status === 'ready') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'running' || status === 'monitoring') return 'info';
  return 'warning';
}

export default function MintsClient() {
  const [tasks, setTasks] = useState<MintTask[]>([]);
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ walletId: '', collectionId: '', quantity: '1' });

  const collectionById = useMemo(() => new Map(collections.map((collection) => [collection.id, collection])), [collections]);
  const walletById = useMemo(() => new Map(wallets.map((wallet) => [wallet.id, wallet])), [wallets]);
  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const queuedCount = tasks.filter((task) => task.status === 'pending' || task.status === 'monitoring').length;
  const readyCount = tasks.filter((task) => task.status === 'ready').length;
  const retryCount = tasks.filter((task) => task.status === 'failed').length;

  useEffect(() => {
    let active = true;

    const run = async () => {
      try {
        const [mintsPayload, walletsPayload, collectionsPayload] = await Promise.all([
          apiRequest<{ tasks: MintTask[] }>('/api/mints'),
          apiRequest<{ wallets: WalletRecord[] }>('/api/wallets'),
          apiRequest<{ collections: CollectionRecord[] }>('/api/collections'),
        ]);

        if (!active) return;
        setTasks(mintsPayload.tasks);
        setWallets(walletsPayload.wallets);
        setCollections(collectionsPayload.collections);
      } catch (requestError) {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : 'Failed to load mint data.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void run();

    return () => {
      active = false;
    };
  }, []);

  const submitMint = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      const payload = await apiRequest<{ task: MintTask }>('/api/mints', {
        method: 'POST',
        body: {
          walletId: form.walletId,
          collectionId: form.collectionId,
          quantity: form.quantity,
        },
      });
      setTasks((current) => [payload.task, ...current]);
      setForm({ walletId: '', collectionId: '', quantity: '1' });
      setModalOpen(false);
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to create mint task.');
    } finally {
      setSaving(false);
    }
  };

  const startTask = async (task: MintTask) => {
    setUpdatingId(task.id);
    setError(null);

    try {
      const payload = await apiRequest<MintActionResponse>('/api/mints', { method: 'PATCH', body: { id: task.id, action: 'start' } });
      setTasks((current) => current.map((item) => (item.id === task.id ? payload.task : item)));
      if (payload.result && !payload.result.success) {
        setError(payload.result.error ?? 'Mint execution failed.');
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to start task.');
    } finally {
      setUpdatingId(null);
    }
  };

  const cancelTask = async (task: MintTask) => {
    setUpdatingId(task.id);
    setError(null);

    try {
      const payload = await apiRequest<MintActionResponse>('/api/mints', { method: 'PATCH', body: { id: task.id, action: 'cancel' } });
      setTasks((current) => current.map((item) => (item.id === task.id ? payload.task : item)));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to cancel task.');
    } finally {
      setUpdatingId(null);
    }
  };

  const deleteTask = async (task: MintTask) => {
    setDeletingId(task.id);
    setError(null);

    try {
      await apiRequest<{ success: true }>('/api/mints', { method: 'DELETE', body: { id: task.id } });
      setTasks((current) => current.filter((item) => item.id !== task.id));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete task.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Execution"
        title="Mints"
        description="Plan, monitor, pause, and retry mint execution tasks with clear risk state and wallet assignment."
        actions={
          <Button type="button" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New Mint
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Executing" value={String(runningCount)} detail="Currently running" icon={Zap} tone="primary" />
        <MetricCard label="Queued" value={String(queuedCount)} detail="Pending or monitoring" icon={CalendarClock} tone="accent" />
        <MetricCard label="Ready" value={String(readyCount)} detail="Strategy approved" icon={ShieldCheck} tone="success" />
        <MetricCard label="Retries" value={String(retryCount)} detail="Failed tasks" icon={RotateCcw} tone="warning" />
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      <Card className="mt-6 overflow-hidden" tone="elevated">
        <div className="grid grid-cols-12 gap-4 border-b border-border px-5 py-3 text-xs font-medium uppercase text-muted">
          <span className="col-span-5">Collection</span>
          <span className="col-span-2 hidden md:block">Status</span>
          <span className="col-span-2 hidden lg:block">Wallet</span>
          <span className="col-span-2 hidden sm:block">Quantity</span>
          <span className="col-span-7 text-right sm:col-span-1">Actions</span>
        </div>
        <div className="divide-y divide-border">
          {loading ? (
            [0, 1, 2].map((item) => (
              <div key={item} className="px-5 py-4">
                <Skeleton className="h-5 w-full" />
              </div>
            ))
          ) : tasks.length > 0 ? (
            tasks.map((task) => {
              const collection = task.collectionId ? collectionById.get(task.collectionId) : null;
              const wallet = task.walletId ? walletById.get(task.walletId) : null;
              const title = collection?.name || task.contractAddress || `Task ${task.id.slice(0, 8)}`;

              return (
                <div key={task.id} className="grid grid-cols-12 gap-4 px-5 py-4">
                  <div className="col-span-5 min-w-0">
                    <p className="truncate font-medium text-text">{title}</p>
                    <p className="mt-1 text-xs text-muted">{collection?.chain ?? wallet?.chain ?? 'unknown'} / fee {task.mintPrice ?? 'unset'}</p>
                  </div>
                  <div className="col-span-2 hidden md:block">
                    <Badge variant={statusVariant(task.status) as 'success' | 'warning' | 'danger' | 'info'}>{task.status}</Badge>
                  </div>
                  <p className="col-span-2 hidden font-mono text-sm text-muted lg:block">{wallet ? shortAddress(wallet.address) : 'Unassigned'}</p>
                  <p className="col-span-2 hidden font-mono text-sm text-text sm:block">{task.quantity}</p>
                  <div className="col-span-7 flex justify-end gap-1 sm:col-span-1">
                    <button type="button" onClick={() => startTask(task)} disabled={updatingId === task.id || task.status === 'running' || task.status === 'completed'} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text disabled:opacity-50" aria-label={`${task.status === 'failed' || task.status === 'cancelled' ? 'Retry' : 'Start'} ${title}`}>
                      <Play className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => cancelTask(task)} disabled={updatingId === task.id || task.status === 'completed' || task.status === 'cancelled'} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-warning disabled:opacity-50" aria-label={`Cancel ${title}`}>
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => deleteTask(task)} disabled={deletingId === task.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-danger disabled:opacity-50" aria-label={`Delete ${title}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-5">
              <EmptyState
                icon={Zap}
                title="No mint tasks"
                description="Create a mint task after adding at least one wallet and one collection."
                action={
                  <Button type="button" onClick={() => setModalOpen(true)}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New Mint
                  </Button>
                }
              />
            </div>
          )}
        </div>
      </Card>

      <Card className="mt-6 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-text">Execution Queue</h2>
            <p className="mt-1 text-sm text-muted">Tasks are created from saved wallets and collections, then started through the mint task route.</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setQueueOpen(true)}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            Queue Settings
          </Button>
        </div>
      </Card>

      <Modal open={modalOpen} title="New Mint" onClose={() => setModalOpen(false)}>
        <form onSubmit={submitMint} className="space-y-4">
          <label className="block text-sm font-medium text-muted">
            Wallet
            <select
              value={form.walletId}
              onChange={(event) => setForm((current) => ({ ...current, walletId: event.target.value }))}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              required
            >
              <option value="">Select wallet</option>
              {wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>{wallet.nickname || shortAddress(wallet.address)} / {wallet.chain}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-muted">
            Collection
            <select
              value={form.collectionId}
              onChange={(event) => setForm((current) => ({ ...current, collectionId: event.target.value }))}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              required
            >
              <option value="">Select collection</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>{collection.name || shortAddress(collection.contractAddress)} / {collection.chain}</option>
              ))}
            </select>
          </label>
          <Input label="Quantity" type="number" min="1" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} required />
          {formError ? <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">{formError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Create Mint</Button>
          </div>
        </form>
      </Modal>

      <Modal open={queueOpen} title="Queue Settings" onClose={() => setQueueOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">Queue controls are currently read from mint task status in the database. Create, start, and delete actions are available on each task.</p>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => setQueueOpen(false)}>Close</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
