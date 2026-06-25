'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Plus, Radar, ShieldAlert, Sparkles, Trash2, TrendingUp } from 'lucide-react';
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

type CollectionRecord = {
  id: string;
  name: string | null;
  contractAddress: string;
  chain: string;
  mintStatus: string | null;
  tokenStandard: string | null;
  totalSupply: string | null;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function statusVariant(status: string | null) {
  if (status === 'live' || status === 'ready') return 'success';
  if (status === 'blocked' || status === 'failed') return 'danger';
  return 'warning';
}

export default function CollectionsClient() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', contractAddress: '', chain: 'ethereum' });

  // Fetch collections with React Query
  const { data: collectionsData, isLoading, error: fetchError } = useQuery({
    queryKey: ['collections'],
    queryFn: () => apiRequest<{ collections: CollectionRecord[] }>('/api/collections'),
  });

  const collections = collectionsData?.collections || [];
  const trackedCount = collections.length;
  const syncedCount = useMemo(() => collections.filter((collection) => collection.tokenStandard || collection.totalSupply).length, [collections]);
  const unknownCount = trackedCount - syncedCount;

  // Set error from fetch error
  useEffect(() => {
    if (fetchError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors React Query fetch failures into dismissible local UI state
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load collections.');
    }
  }, [fetchError]);

  // Add collection mutation
  const addCollectionMutation = useMutation({
    mutationFn: async (data: { name: string; contractAddress: string; chain: string }) => {
      return apiRequest<{ collection: CollectionRecord }>('/api/collections', {
        method: 'POST',
        body: data,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setModalOpen(false);
    },
  });

  // Delete collection mutation
  const deleteCollectionMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<{ success: true }>(`/api/collections/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    },
  });

  const submitCollection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      await addCollectionMutation.mutateAsync({
        name: form.name.trim(),
        contractAddress: form.contractAddress.trim(),
        chain: form.chain,
      });
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'Failed to add collection.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCollection = async (id: string) => {
    setDeletingId(id);
    setError(null);

    try {
      await deleteCollectionMutation.mutateAsync(id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to delete collection.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Research"
        title="Collections"
        description="Manage collection watchlists, launchpad metadata, demand signals, and risk posture."
        actions={
          <Button type="button" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Collection
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Tracked" value={String(trackedCount)} detail="Loaded from saved collections" icon={FolderKanban} tone="primary" />
        <MetricCard label="Synced" value={String(syncedCount)} detail="Metadata available" icon={TrendingUp} tone="accent" />
        <MetricCard label="Needs Review" value={String(unknownCount)} detail="Awaiting metadata sync" icon={ShieldAlert} tone="danger" />
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item} className="p-5">
              <Skeleton className="h-10 w-10" />
              <Skeleton className="mt-5 h-5 w-40" />
              <Skeleton className="mt-3 h-4 w-full" />
            </Card>
          ))}
        </div>
      ) : collections.length > 0 ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {collections.map((collection) => (
            <Card key={collection.id} tone="interactive" className="p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={statusVariant(collection.mintStatus) as 'success' | 'warning' | 'danger'}>{collection.mintStatus ?? 'unknown'}</Badge>
                  <button
                    type="button"
                    onClick={() => deleteCollection(collection.id)}
                    disabled={deletingId === collection.id}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-danger disabled:opacity-50"
                    aria-label={`Delete ${collection.name ?? collection.contractAddress}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <h2 className="truncate font-semibold text-text">{collection.name || shortAddress(collection.contractAddress)}</h2>
              <p className="mt-1 text-sm text-muted">{collection.chain}</p>
              <p className="mt-2 truncate font-mono text-xs text-muted">{collection.contractAddress}</p>
              <div className="mt-5 flex items-center justify-between">
                <span className="text-sm text-muted">{collection.tokenStandard ?? 'Unverified'}</span>
                <span className="font-mono text-xl text-text">{collection.totalSupply ?? '--'}</span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={Radar}
            title="No collections tracked"
            description="Paste a launchpad URL or import a watchlist to start scoring collection risk, demand, and execution readiness."
            action={
              <Button type="button" onClick={() => setModalOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add Collection
              </Button>
            }
          />
        </div>
      )}

      <Modal open={modalOpen} title="Add Collection" onClose={() => setModalOpen(false)}>
        <form onSubmit={submitCollection} className="space-y-4">
          <Input label="Name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Eclipse Foundry" required />
          <Input label="Contract Address" value={form.contractAddress} onChange={(event) => setForm((current) => ({ ...current, contractAddress: event.target.value }))} placeholder="0x..." required />
          <label className="block text-sm font-medium text-muted">
            Chain
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
            <Button type="submit" loading={saving}>Add Collection</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
