'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Copy, Eye, EyeOff, ExternalLink, Plus, RefreshCw, Shield,
  Star, Trash2, Wallet, TrendingUp, Activity,
} from 'lucide-react';
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

type WalletRecord = {
  id: string; address: string; nickname: string | null; chain: string;
  walletType: string; isDefault: boolean; balance: string | null; createdAt: string;
};

const chainGlow: Record<string, string> = {
  ethereum: '0 0 20px rgba(0,245,255,0.20)',
  base:     '0 0 20px rgba(124,58,237,0.20)',
  polygon:  '0 0 20px rgba(236,72,153,0.20)',
  arbitrum: '0 0 20px rgba(59,130,246,0.20)',
};
const chainAccent: Record<string, string> = {
  ethereum: 'text-neon border-neon/25 bg-neon/8',
  base:     'text-primary border-primary/25 bg-primary/8',
  polygon:  'text-accent border-accent/25 bg-accent/8',
  arbitrum: 'text-info border-info/25 bg-info/8',
};

function WalletCard({
  wallet, onDelete, onSetDefault, onRefresh,
  deleting, settingDefault, refreshing,
}: {
  wallet: WalletRecord;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
  onRefresh: (id: string) => void;
  deleting: boolean; settingDefault: boolean; refreshing: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const bal = wallet.balance ? parseFloat(wallet.balance) : 0;
  const funded = bal > 0.001;
  const accentClass = chainAccent[wallet.chain] ?? 'text-muted border-border bg-surface';
  const glowStyle = { boxShadow: wallet.isDefault ? (chainGlow[wallet.chain] ?? 'none') : 'none' };

  function copyAddress() {
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card tone={wallet.isDefault ? 'neon' : 'elevated'} className="p-5 transition-all duration-300" style={glowStyle}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl border bg-background text-neon"
            style={{ borderColor: wallet.isDefault ? 'rgba(0,245,255,0.30)' : undefined, boxShadow: wallet.isDefault ? '0 0 12px rgba(0,245,255,0.20)' : undefined }}
          >
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="font-bold text-text text-sm">{wallet.nickname ?? 'Unnamed Wallet'}</p>
            <p className="text-[10px] text-muted font-mono">
              {revealed ? wallet.address : `${wallet.address.slice(0, 10)}…${wallet.address.slice(-6)}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {wallet.isDefault && <Badge variant="gold" dot pulse>Default</Badge>}
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${accentClass}`}>{wallet.chain}</span>
          <Badge variant={funded ? 'success' : 'default'} dot={funded}>{funded ? 'Funded' : 'Empty'}</Badge>
        </div>
      </div>

      {/* Balance */}
      <div className="mb-4 rounded-xl border border-border bg-background/60 p-4 flex items-center justify-between">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted mb-1">Balance</p>
          <p className="text-2xl font-black text-text tabular-nums">{bal.toFixed(4)} <span className="text-sm text-muted">ETH</span></p>
        </div>
        <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${funded ? 'bg-success/10 border border-success/25' : 'bg-white/5 border border-border'}`}>
          <Activity className={`h-5 w-5 ${funded ? 'text-success' : 'text-muted'}`} />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={copyAddress} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-text hover:border-border-strong transition-colors">
          <Copy className="h-3 w-3" />{copied ? 'Copied!' : 'Copy'}
        </button>
        <button onClick={() => setRevealed(!revealed)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-text hover:border-border-strong transition-colors">
          {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{revealed ? 'Hide' : 'Show'}
        </button>
        <a
          href={`https://etherscan.io/address/${wallet.address}`}
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-text hover:border-border-strong transition-colors"
        >
          <ExternalLink className="h-3 w-3" />Explorer
        </a>
        <Button variant="ghost" size="xs" onClick={() => onRefresh(wallet.id)} loading={refreshing}><RefreshCw className="h-3 w-3" /></Button>
        {!wallet.isDefault && (
          <Button variant="gold" size="xs" onClick={() => onSetDefault(wallet.id)} loading={settingDefault}><Star className="h-3 w-3" />Default</Button>
        )}
        <Button variant="ghost" size="xs" onClick={() => onDelete(wallet.id)} loading={deleting} className="ml-auto hover:text-danger"><Trash2 className="h-3 w-3" /></Button>
      </div>
    </Card>
  );
}

export default function WalletsClient() {
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ address: '', privateKey: '', nickname: '', chain: 'ethereum' });
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: wallets = [], isLoading } = useQuery<WalletRecord[]>({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<WalletRecord[]>('/api/wallets'),
  });

  const addMutation = useMutation({
    mutationFn: (body: object) => apiRequest('/api/wallets', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['wallets'] }); setAddOpen(false); setForm({ address: '', privateKey: '', nickname: '', chain: 'ethereum' }); },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/wallets/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['wallets'] }); setDeletingId(null); },
  });

  const defaultMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/wallets/${id}/default`, { method: 'POST' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['wallets'] }); setSettingDefaultId(null); },
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/blockchain/balance?walletId=${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['wallets'] }); setRefreshingId(null); },
  });

  const totalEth = wallets.reduce((s, w) => s + (parseFloat(w.balance ?? '0') || 0), 0);
  const funded = wallets.filter(w => parseFloat(w.balance ?? '0') > 0.001).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Wallets"
        subtitle="Manage your minting wallets"
        icon={Wallet}
        iconTone="success"
        actions={
          <Button variant="success" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" />Add Wallet
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Wallets" value={wallets.length} icon={Wallet} tone="primary" />
        <MetricCard label="Funded" value={funded} icon={TrendingUp} tone="success" />
        <MetricCard label="Portfolio" value={`${totalEth.toFixed(4)} ETH`} icon={Activity} tone="gold" />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={3} />)}
        </div>
      ) : wallets.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No wallets connected"
          description="Add a wallet to start auto-minting NFTs across all supported chains."
          action={<Button variant="success" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" />Add Wallet</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {wallets.map(w => (
            <WalletCard
              key={w.id}
              wallet={w}
              onDelete={id => { setDeletingId(id); deleteMutation.mutate(id); }}
              onSetDefault={id => { setSettingDefaultId(id); defaultMutation.mutate(id); }}
              onRefresh={id => { setRefreshingId(id); refreshMutation.mutate(id); }}
              deleting={deletingId === w.id}
              settingDefault={settingDefaultId === w.id}
              refreshing={refreshingId === w.id}
            />
          ))}
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Wallet" subtitle="Securely add a signing wallet" tone="neon">
        <form onSubmit={e => { e.preventDefault(); setFormError(null); addMutation.mutate(form); }} className="space-y-4">
          <Input label="Wallet Address" placeholder="0x…" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} required error={formError ?? undefined} />
          <Input label="Private Key" type="password" placeholder="Enter private key (stored encrypted)" value={form.privateKey} onChange={e => setForm(p => ({ ...p, privateKey: e.target.value }))} required />
          <Input label="Nickname (optional)" placeholder="Hot wallet 1" value={form.nickname} onChange={e => setForm(p => ({ ...p, nickname: e.target.value }))} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold uppercase tracking-widest text-secondary">Chain</label>
            <select value={form.chain} onChange={e => setForm(p => ({ ...p, chain: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background/80 px-3 text-sm text-text focus:border-neon/60 focus:outline-none focus:ring-2 focus:ring-neon/15"
            >
              {['ethereum','base','polygon','arbitrum','optimism'].map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </select>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/5 p-3">
            <Shield className="h-4 w-4 text-warning shrink-0 mt-0.5" />
            <p className="text-xs text-warning">Private keys are AES-256 encrypted at rest and never logged.</p>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)} className="flex-1">Cancel</Button>
            <Button type="submit" variant="neon" loading={addMutation.isPending} className="flex-1"><Plus className="h-3.5 w-3.5" />Add Wallet</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
