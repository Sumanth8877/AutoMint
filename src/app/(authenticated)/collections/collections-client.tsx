'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FolderKanban, Plus, Search, Trash2, Zap, Shield } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonCard } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api/client';

type Collection = {
  id: string; name: string | null; contractAddress: string; chain: string;
  mintPrice: string | null; totalSupply: number | null; mintedCount: number | null;
  createdAt: string; riskScore: number | null; isPublic: boolean | null;
};

const chainColors: Record<string, string> = {
  ethereum: 'text-neon border-neon/25 bg-neon/8',
  base:     'text-primary border-primary/25 bg-primary/8',
  polygon:  'text-accent border-accent/25 bg-accent/8',
  arbitrum: 'text-info border-info/25 bg-info/8',
};

function riskBadge(score: number | null) {
  if (score === null) return null;
  if (score >= 80) return <Badge variant="danger" dot>High Risk {score}</Badge>;
  if (score >= 50) return <Badge variant="warning" dot>Med Risk {score}</Badge>;
  return <Badge variant="success" dot>Safe {score}</Badge>;
}

function CollectionCard({ col, onDelete, deleting }: { col: Collection; onDelete: (id: string) => void; deleting: boolean }) {
  const filled = col.mintedCount !== null && col.totalSupply ? Math.min((col.mintedCount / col.totalSupply) * 100, 100) : null;
  const chainStyle = chainColors[col.chain] ?? 'text-muted border-border bg-surface';

  return (
    <Card tone="neon" className="p-5 group hover:scale-[1.01] transition-transform duration-200">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background">
            <FolderKanban className="h-4 w-4 text-neon" />
          </div>
          <div>
            <p className="font-bold text-text text-sm">{col.name ?? 'Unnamed Collection'}</p>
            <p className="text-[10px] font-mono text-muted">{col.contractAddress.slice(0, 10)}…{col.contractAddress.slice(-6)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${chainStyle}`}>{col.chain}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-background/50 p-2.5 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted mb-1">Supply</p>
          <p className="text-sm font-black text-text">{col.totalSupply?.toLocaleString() ?? '–'}</p>
        </div>
        <div className="rounded-lg bg-background/50 p-2.5 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted mb-1">Minted</p>
          <p className="text-sm font-black text-text">{col.mintedCount?.toLocaleString() ?? '–'}</p>
        </div>
        <div className="rounded-lg bg-background/50 p-2.5 text-center">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted mb-1">Price</p>
          <p className="text-sm font-black text-gold">{col.mintPrice ?? 'Free'}</p>
        </div>
      </div>

      {/* Mint progress bar */}
      {filled !== null && (
        <div className="mb-4">
          <div className="flex justify-between mb-1.5">
            <span className="text-[10px] text-muted">Mint Progress</span>
            <span className="text-[10px] font-bold text-neon">{filled.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
            <div className="mint-progress-bar h-full" style={{ width: `${filled}%` }} />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {riskBadge(col.riskScore)}
          {col.isPublic && <Badge variant="neon" dot>Live</Badge>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="neon"
            size="xs"
            onClick={() => window.location.href = `/mints?mintUrl=https://etherscan.io/address/${col.contractAddress}`}
          >
            <Zap className="h-3 w-3" />Mint
          </Button>
          <a
            href={`https://etherscan.io/address/${col.contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:text-text hover:border-border-strong transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
          <Button variant="ghost" size="xs" onClick={() => onDelete(col.id)} loading={deleting} className="hover:text-danger">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function CollectionsClient() {
  const [addOpen, setAddOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', contractAddress: '', chain: 'ethereum' });
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: collections = [], isLoading } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => apiRequest<{ collections: Collection[] }>('/api/collections').then(r => r.collections ?? []),
  });

  const addMutation = useMutation({
    mutationFn: (body: object) => apiRequest<{ collection: Collection }>('/api/collections', { method: 'POST', body: JSON.stringify(body) }).then(r => r.collection),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['collections'] }); setAddOpen(false); setForm({ name: '', contractAddress: '', chain: 'ethereum' }); },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/collections/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['collections'] }); setDeletingId(null); },
    onError: () => setDeletingId(null),
  });

  const filtered = collections.filter(c =>
    c.name?.toLowerCase().includes(searchQ.toLowerCase()) ||
    c.contractAddress.toLowerCase().includes(searchQ.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Collections"
        subtitle={`${collections.length} tracked contracts`}
        icon={FolderKanban}
        iconTone="purple"
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />Add Collection
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Tracked" value={collections.length} icon={FolderKanban} tone="primary" />
        <MetricCard label="Live Mints" value={collections.filter(c => c.isPublic).length} icon={Zap} tone="neon" />
        <MetricCard label="Safe Contracts" value={collections.filter(c => c.riskScore !== null && c.riskScore < 50).length} icon={Shield} tone="success" />
      </div>

      {/* Search */}
      <Input
        placeholder="Search collections or contract addresses…"
        value={searchQ}
        onChange={e => setSearchQ(e.target.value)}
        leftIcon={<Search className="h-3.5 w-3.5" />}
      />

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={3} />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={searchQ ? 'No matching collections' : 'No collections yet'}
          description={searchQ ? 'Try a different search term' : 'Add your first NFT collection to start tracking and minting.'}
          action={!searchQ ? <Button variant="primary" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" />Add Collection</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(col => (
            <CollectionCard
              key={col.id}
              col={col}
              onDelete={id => { setDeletingId(id); deleteMutation.mutate(id); }}
              deleting={deletingId === col.id}
            />
          ))}
        </div>
      )}

      {/* Add modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Collection" subtitle="Track a new NFT contract" tone="neon">
        <form
          onSubmit={e => { e.preventDefault(); setFormError(null); addMutation.mutate(form); }}
          className="space-y-4"
        >
          <Input label="Collection Name" placeholder="Bored Apes…" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          <Input label="Contract Address" placeholder="0x…" value={form.contractAddress} onChange={e => setForm(p => ({ ...p, contractAddress: e.target.value }))} required error={formError ?? undefined} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-secondary">Chain</label>
            <select
              value={form.chain}
              onChange={e => setForm(p => ({ ...p, chain: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background/80 px-3 text-sm text-text focus:border-neon/60 focus:outline-none focus:ring-2 focus:ring-neon/15"
            >
              {['ethereum', 'base', 'polygon', 'arbitrum', 'optimism'].map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" variant="neon" loading={addMutation.isPending} className="flex-1"><Plus className="h-3.5 w-3.5" />Add</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
