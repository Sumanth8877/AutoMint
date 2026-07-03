'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FolderKanban, RefreshCw, Search, Trash2, TrendingDown, TrendingUp, Zap, Shield } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Stagger, StaggerItem, TiltCard } from '@/components/motion';
import { apiRequest } from '@/lib/api/client';

type Collection = {
  id: string; name: string | null; contractAddress: string; chain: string;
  mintPrice: string | null; totalSupply: number | null; mintedCount: number | null;
  createdAt: string; riskScore: number | null; isPublic: boolean | null;
  floorPrice?: string | null; previousFloorPrice?: string | null; floorChangePercent?: string | null;
};

const chainColors: Record<string, string> = {
  ethereum: 'text-primary border-primary/15 bg-indigo-50',
  base:     'text-primary border-primary/15 bg-indigo-50',
  polygon:  'text-primary border-primary/15 bg-indigo-50',
  arbitrum: 'text-info border-slate-200 bg-slate-100',
};

function riskBadge(score: number | null) {
  if (score === null) return null;
  if (score >= 80) return <Badge variant="danger" dot>High Risk {score}</Badge>;
  if (score >= 50) return <Badge variant="warning" dot>Med Risk {score}</Badge>;
  return <Badge variant="success" dot>Safe {score}</Badge>;
}

function FloorMovement({ changePercent }: { changePercent?: string | null }) {
  if (!changePercent) return null;
  const value = parseFloat(changePercent);
  if (Number.isNaN(value)) return null;
  const up = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-bold ${up ? 'text-success' : 'text-danger'}`}>
      {up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
      {changePercent}%
    </span>
  );
}

function CollectionCard({
  col, onDelete, deleting, onRefreshFloor, refreshingFloor,
}: {
  col: Collection;
  onDelete: (id: string) => void;
  deleting: boolean;
  onRefreshFloor: (id: string) => void;
  refreshingFloor: boolean;
}) {
  const filled = col.mintedCount !== null && col.totalSupply ? Math.min((col.mintedCount / col.totalSupply) * 100, 100) : null;
  const chainStyle = chainColors[col.chain] ?? 'text-muted border-border bg-surface';

  return (
    <TiltCard max={4} className="h-full">
    <Card tone="neon" className="p-5 group h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface">
            <FolderKanban className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-bold text-text text-sm">{col.name ?? 'Unnamed Collection'}</p>
            <p className="text-xs font-mono text-muted">{col.contractAddress.slice(0, 10)}…{col.contractAddress.slice(-6)}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${chainStyle}`}>{col.chain}</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="rounded-lg bg-surface-hover p-2.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">Supply</p>
          <p className="text-sm font-bold text-text">{col.totalSupply?.toLocaleString() ?? '–'}</p>
        </div>
        <div className="rounded-lg bg-surface-hover p-2.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">Minted</p>
          <p className="text-sm font-bold text-text">{col.mintedCount?.toLocaleString() ?? '–'}</p>
        </div>
        <div className="rounded-lg bg-surface-hover p-2.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">Price</p>
          <p className="text-sm font-bold text-gold">{col.mintPrice ?? 'Free'}</p>
        </div>
        <div className="rounded-lg bg-surface-hover p-2.5 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-1">Floor</p>
          <p className="stat-value text-sm font-bold text-text">{col.floorPrice ?? '–'}</p>
          <FloorMovement changePercent={col.floorChangePercent} />
        </div>
      </div>

      {/* Mint progress bar */}
      {filled !== null && (
        <div className="mb-4">
          <div className="flex justify-between mb-1.5">
            <span className="text-xs text-muted">Mint Progress</span>
            <span className="text-xs font-bold text-primary">{filled.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-surface-hover overflow-hidden">
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
          <button
            onClick={() => onRefreshFloor(col.id)}
            disabled={refreshingFloor}
            aria-label="Refresh floor price"
            title="Refresh floor price"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:text-text hover:border-border-strong transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshingFloor ? 'animate-spin' : ''}`} />
          </button>
          <Button variant="ghost" size="xs" onClick={() => onDelete(col.id)} loading={deleting} className="hover:text-danger">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </Card>
    </TiltCard>
  );
}

export default function CollectionsClient() {
  const [searchQ, setSearchQ] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: collections = [], isLoading } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: () => apiRequest<{ collections: Collection[] }>('/api/collections').then(r => r.collections ?? []),
  });




  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/collections/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['collections'] }); setDeletingId(null); },
    onError: () => setDeletingId(null),
  });

  const [refreshingFloorId, setRefreshingFloorId] = useState<string | null>(null);
  const refreshFloorMutation = useMutation({
    mutationFn: (id: string) => apiRequest<{ collection: Collection }>(`/api/collections/${id}/refresh-floor`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
    onSettled: () => setRefreshingFloorId(null),
  });
  const handleRefreshFloor = (id: string) => {
    setRefreshingFloorId(id);
    refreshFloorMutation.mutate(id);
  };

  const filtered = collections.filter(c =>
    c.name?.toLowerCase().includes(searchQ.toLowerCase()) ||
    c.contractAddress.toLowerCase().includes(searchQ.toLowerCase())
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="My Minted NFTs"
        subtitle={`${collections.length} successfully minted`}
        icon={FolderKanban}
        iconTone="purple"
        actions={null}
      />

      {/* Stats */}
      <Stagger className="grid gap-4 sm:grid-cols-3" inView>
        <StaggerItem><MetricCard label="Total Minted" value={collections.length} icon={FolderKanban} tone="primary" /></StaggerItem>
        <StaggerItem><MetricCard label="Live Mints" value={collections.filter(c => c.isPublic).length} icon={Zap} tone="neon" /></StaggerItem>
        <StaggerItem><MetricCard label="Safe Contracts" value={collections.filter(c => c.riskScore !== null && c.riskScore < 50).length} icon={Shield} tone="success" /></StaggerItem>
      </Stagger>

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
          {...(searchQ
            ? {
                icon: FolderKanban,
                title: 'No matching collections',
                description: 'Try a different search term',
              }
            : {
                image: '/illustrations/empty-collections.jpeg',
                imageAlt: 'A character beside a gallery wall of empty frames, waiting for the first minted NFT to hang up.',
                title: 'No minted NFTs yet',
                description: 'Collections appear here automatically after a successful mint through AutoMint. Head to the Mints page to queue your first mint.',
                action: <Button variant="primary" onClick={() => window.location.href = '/mints'}><Zap className="h-3.5 w-3.5" />Queue a Mint</Button>,
              })}
        />
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" inView stagger={0.06}>
          {filtered.map(col => (
            <StaggerItem key={col.id}>
              <CollectionCard
                col={col}
                onDelete={id => { setDeletingId(id); deleteMutation.mutate(id); }}
                deleting={deletingId === col.id}
                onRefreshFloor={handleRefreshFloor}
                refreshingFloor={refreshingFloorId === col.id}
              />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      
    </div>
  );
}
