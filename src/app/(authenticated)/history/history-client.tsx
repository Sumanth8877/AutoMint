'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Copy, Eye, Gauge, Pencil, ReceiptText, RefreshCcw, Search, Trash2 } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api/client';

type TabKey = 'mints' | 'scheduled' | 'analyzer';
type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info';

type MintHistoryRow = {
  id: string;
  collectionName: string | null;
  contractAddress: string | null;
  walletName: string | null;
  walletAddress: string | null;
  quantity: number;
  mintPrice: string | null;
  gasUsed: string | null;
  status: string;
  transactionHash: string | null;
  executionStartedAt: string;
  executionCompletedAt: string | null;
  updatedAt: string;
};

type ScheduledTaskRow = {
  id: string;
  collectionId: string | null;
  collectionName: string | null;
  contractAddress: string | null;
  walletId: string | null;
  walletName: string | null;
  walletAddress: string | null;
  quantity: number;
  status: string;
  scheduledTime: string | null;
  createdAt: string;
  updatedAt: string;
};

type AnalyzerHistoryRow = {
  id: string;
  input: string;
  sourceUrl: string;
  collectionName: string | null;
  contractAddress: string | null;
  chain: string;
  riskScore: number | null;
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  riskFactors: string[] | null;
  floorPrice: string | null;
  floorCurrency: string | null;
  floorSymbol: string | null;
  ownerCount: number | null;
  volume: string | null;
  marketStatus: string | null;
  healthScore: number | null;
  opportunityScore: number;
  readinessScore: number;
  mintState: string;
  providerUsed: string;
  cacheUsed: boolean;
  rpcProviderUsed: string | null;
  socials: {
    website?: string;
    twitter?: string;
    discord?: string;
    telegram?: string;
  } | null;
  socialCount: number;
  analysisDurationMs: number;
  createdAt: string;
};

type HistoryResponse<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

type SelectedRow =
  | { type: 'mint'; item: MintHistoryRow }
  | { type: 'scheduled'; item: ScheduledTaskRow }
  | { type: 'analyzer'; item: AnalyzerHistoryRow }
  | null;

const tabs: Array<{ key: TabKey; label: string; icon: typeof ReceiptText }> = [
  { key: 'mints', label: 'Mint History', icon: ReceiptText },
  { key: 'scheduled', label: 'Scheduled Tasks', icon: CalendarClock },
  { key: 'analyzer', label: 'Analyzer History', icon: Gauge },
];

const mintStatusOptions = ['All', 'Success', 'Failed', 'Pending', 'Cancelled'];
const scheduledStatusOptions = ['All', 'Scheduled', 'Waiting', 'Executing', 'Completed', 'Failed', 'Cancelled'];
const analyzerFilterOptions = ['All', 'Ethereum', 'Base', 'Polygon', 'Solana', 'Recent'];

function shortAddress(address?: string | null) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Unassigned';
}

function collectionLabel(item: { collectionName: string | null; contractAddress: string | null }) {
  return item.collectionName || shortAddress(item.contractAddress);
}

function walletLabel(item: { walletName: string | null; walletAddress: string | null }) {
  return item.walletName || shortAddress(item.walletAddress);
}

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateTimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return 'Not completed';
  const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatMilliseconds(value: number) {
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}s`;
}

function formatSocials(socials: AnalyzerHistoryRow['socials']) {
  if (!socials) return 'None recorded';
  const entries = Object.entries(socials).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(', ') : 'None recorded';
}

function formatMetric(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (typeof value === 'number') return value.toLocaleString();
  return value;
}

function formatFloorPrice(item: Pick<AnalyzerHistoryRow, 'floorPrice' | 'floorCurrency' | 'floorSymbol'>) {
  if (!item.floorPrice) return 'Unavailable';
  const symbol = item.floorSymbol ?? item.floorCurrency;
  if (!symbol || item.floorPrice.toLowerCase().includes(symbol.toLowerCase())) return item.floorPrice;
  return `${item.floorPrice} ${symbol}`;
}

function formatCountdown(value?: string | null) {
  if (!value) return 'Waiting for schedule';
  const diff = new Date(value).getTime() - Date.now();
  if (diff <= 0) return 'Ready now';
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `Starts in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `Starts in ${hours}h ${remainingMinutes}m` : `Starts in ${hours}h`;
  const days = Math.ceil(hours / 24);
  return `Starts in ${days}d`;
}

function formatCost(item: MintHistoryRow) {
  const mintPrice = Number(item.mintPrice ?? 0);
  const gasCost = Number(item.gasUsed ?? 0);
  const normalizedGasCost = Number.isFinite(gasCost) && gasCost > 0 && gasCost < 10 ? gasCost : 0;
  const total = (Number.isFinite(mintPrice) ? mintPrice * item.quantity : 0) + normalizedGasCost;
  return total > 0 ? `${total.toFixed(total >= 1 ? 3 : 4).replace(/0+$/, '').replace(/\.$/, '')} ETH` : 'Unset';
}

function mintStatus(status: string): { label: string; variant: BadgeVariant } {
  if (status === 'completed') return { label: 'SUCCESS', variant: 'success' };
  if (status === 'failed') return { label: 'FAILED', variant: 'danger' };
  if (status === 'cancelled') return { label: 'CANCELLED', variant: 'warning' };
  return { label: 'PENDING', variant: 'info' };
}

function scheduledStatus(status: string): { label: string; variant: BadgeVariant } {
  if (status === 'monitoring') return { label: 'Scheduled', variant: 'info' };
  if (status === 'pending' || status === 'ready') return { label: 'Waiting', variant: 'warning' };
  if (status === 'running') return { label: 'Executing', variant: 'info' };
  if (status === 'completed') return { label: 'Completed', variant: 'success' };
  if (status === 'failed') return { label: 'Failed', variant: 'danger' };
  return { label: 'Cancelled', variant: 'warning' };
}

function riskBadgeVariant(level?: string | null): BadgeVariant {
  if (level === 'Low') return 'success';
  if (level === 'Medium') return 'info';
  if (level === 'High') return 'warning';
  if (level === 'Critical') return 'danger';
  return 'default';
}

function optionValue(label: string) {
  return label === 'All' ? '' : label.toLowerCase().replace(' risk', '');
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center justify-between border-t border-border px-5 py-4">
      <span className="text-sm text-muted">Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button type="button" variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-border bg-white/5 p-3">
          <p className="text-xs uppercase text-muted">{label}</p>
          <p className="mt-1 break-words text-sm font-medium text-text">{value}</p>
        </div>
      ))}
    </div>
  );
}

export default function HistoryClient() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('mints');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [analyzerFilter, setAnalyzerFilter] = useState('');
  const [page, setPage] = useState(1);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedRow>(null);
  const [editing, setEditing] = useState<ScheduledTaskRow | null>(null);
  const [editForm, setEditForm] = useState({ scheduledTime: '', quantity: '1' });

  // Fetch mint history with React Query
  const { data: mintData, isLoading: mintLoading, error: mintError } = useQuery({
    queryKey: ['mint-history', activeTab, page, search, status],
    queryFn: () => apiRequest<HistoryResponse<MintHistoryRow>>(`/api/history?tab=mints&page=${page}&search=${search}&status=${status}`),
    enabled: activeTab === 'mints',
  });

  // Fetch scheduled tasks with React Query
  const { data: scheduledData, isLoading: scheduledLoading, error: scheduledError } = useQuery({
    queryKey: ['scheduled-history', activeTab, page, search, status],
    queryFn: () => apiRequest<HistoryResponse<ScheduledTaskRow>>(`/api/history?tab=scheduled&page=${page}&search=${search}&status=${status}`),
    enabled: activeTab === 'scheduled',
  });

  // Fetch analyzer history with React Query
  const { data: analyzerData, isLoading: analyzerLoading, error: analyzerError } = useQuery({
    queryKey: ['analyzer-history', activeTab, page, search, analyzerFilter],
    queryFn: () => apiRequest<HistoryResponse<AnalyzerHistoryRow>>(`/api/history?tab=analyzer&page=${page}&search=${search}&filter=${analyzerFilter}`),
    enabled: activeTab === 'analyzer',
  });

  const mintRows = mintData?.items || [];
  const scheduledRows = scheduledData?.items || [];
  const analyzerRows = analyzerData?.items || [];
  const totalPages = (mintData?.totalPages || scheduledData?.totalPages || analyzerData?.totalPages || 1);
  const loading = activeTab === 'mints' ? mintLoading : activeTab === 'scheduled' ? scheduledLoading : analyzerLoading;
  const fetchError = activeTab === 'mints' ? mintError : activeTab === 'scheduled' ? scheduledError : analyzerError;

  const filterOptions = activeTab === 'mints' ? mintStatusOptions : activeTab === 'scheduled' ? scheduledStatusOptions : analyzerFilterOptions;
  const activeItems = useMemo(() => {
    if (activeTab === 'mints') return mintRows;
    if (activeTab === 'scheduled') return scheduledRows;
    return analyzerRows;
  }, [activeTab, analyzerRows, mintRows, scheduledRows]);

  // Set error from fetch error
  useEffect(() => {
    if (fetchError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors React Query fetch failures into local UI state
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load history data.');
    }
  }, [fetchError]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setPage(1), 250);
    return () => window.clearTimeout(timeout);
  }, [activeTab, analyzerFilter, search, status]);

  // Edit scheduled task mutation
  const editScheduledMutation = useMutation({
    mutationFn: async ({ id, scheduledTime, quantity }: { id: string; scheduledTime: string; quantity: string }) => {
      return apiRequest<{ task: ScheduledTaskRow }>(`/api/history/scheduled/${id}`, {
        method: 'PATCH',
        body: { scheduledTime, quantity: Number(quantity) },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-history'] });
    },
  });

  // Delete scheduled task mutation
  const deleteScheduledMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<{ success: true }>(`/api/history/scheduled/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-history'] });
    },
  });

  const refreshActiveTab = () => {
    if (activeTab === 'mints') {
      queryClient.invalidateQueries({ queryKey: ['mint-history'] });
    } else if (activeTab === 'scheduled') {
      queryClient.invalidateQueries({ queryKey: ['scheduled-history'] });
    } else {
      queryClient.invalidateQueries({ queryKey: ['analyzer-history'] });
    }
  };

  const runTaskAction = async (task: ScheduledTaskRow, action: 'cancel' | 'duplicate') => {
    setUpdatingId(task.id);
    setError(null);
    try {
      await apiRequest('/api/history', { method: 'PATCH', body: { taskId: task.id, action } });
      if (action === 'cancel') {
        queryClient.invalidateQueries({ queryKey: ['scheduled-history'] });
      } else {
        refreshActiveTab();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Failed to ${action} task.`);
    } finally {
      setUpdatingId(null);
    }
  };

  const openEdit = (task: ScheduledTaskRow) => {
    setEditing(task);
    setEditForm({ scheduledTime: formatDateTimeLocal(task.scheduledTime), quantity: String(task.quantity) });
  };

  const submitEdit = async () => {
    if (!editing) return;
    setUpdatingId(editing.id);
    setError(null);
    try {
      await editScheduledMutation.mutateAsync({
        id: editing.id,
        scheduledTime: editForm.scheduledTime ? new Date(editForm.scheduledTime).toISOString() : '',
        quantity: editForm.quantity,
      });
      setEditing(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to edit task.');
    } finally {
      setUpdatingId(null);
    }
  };

  const reanalyze = async (item: AnalyzerHistoryRow) => {
    const input = item.contractAddress ?? item.sourceUrl ?? item.input;
    if (!input) return;
    setUpdatingId(item.id);
    setError(null);
    try {
      await apiRequest('/api/analyzer', { method: 'POST', body: { input } });
      queryClient.invalidateQueries({ queryKey: ['analyzer-history'] });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to reanalyze collection.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="History"
        description="Mint executions, scheduled tasks, and analyzer results from your AutoMint records."
      />

      <Card tone="elevated" className="overflow-hidden">
        <div className="border-b border-border p-4">
          <div className="grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const selectedTab = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.key);
                      setStatus('');
                      setAnalyzerFilter('');
                      setPage(1);
                    }}
                    className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors ${selectedTab ? 'border-primary/40 bg-primary/15 text-text' : 'border-border bg-white/5 text-muted hover:text-text'}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeTab === 'analyzer' ? 'Search collection or contract' : 'Search collection or wallet'} icon={<Search className="h-4 w-4" aria-hidden="true" />} />
            <select
              value={activeTab === 'analyzer' ? analyzerFilter : status}
              onChange={(event) => {
                if (activeTab === 'analyzer') setAnalyzerFilter(event.target.value);
                else setStatus(event.target.value);
              }}
              className="h-11 rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {filterOptions.map((option) => (
                <option key={option} value={optionValue(option)}>{option}</option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <div className="m-5 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">{error}</div>
        ) : null}

        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-14 w-full" />)}
          </div>
        ) : activeItems.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={activeTab === 'mints' ? ReceiptText : activeTab === 'scheduled' ? CalendarClock : Gauge}
              title={activeTab === 'mints' ? 'No mint history' : activeTab === 'scheduled' ? 'No scheduled tasks' : 'No analyzer history'}
              description="No matching operational records were found."
            />
          </div>
        ) : activeTab === 'mints' ? (
          <MintHistoryTable rows={mintRows} onSelect={(item) => setSelected({ type: 'mint', item })} />
        ) : activeTab === 'scheduled' ? (
          <ScheduledTaskTable rows={scheduledRows} updatingId={updatingId} onSelect={(item) => setSelected({ type: 'scheduled', item })} onEdit={openEdit} onCancel={(item) => void runTaskAction(item, 'cancel')} onDuplicate={(item) => void runTaskAction(item, 'duplicate')} />
        ) : (
          <AnalyzerHistoryTable rows={analyzerRows} updatingId={updatingId} onSelect={(item) => setSelected({ type: 'analyzer', item })} onReanalyze={(item) => void reanalyze(item)} />
        )}

        {!loading && activeItems.length > 0 ? <Pagination page={page} totalPages={totalPages} onPage={setPage} /> : null}
      </Card>

      <DetailsModal selected={selected} onClose={() => setSelected(null)} />
      <Modal open={Boolean(editing)} title="Edit Scheduled Task" onClose={() => setEditing(null)}>
        <div className="space-y-4">
          <Input label="Scheduled Time" type="datetime-local" value={editForm.scheduledTime} onChange={(event) => setEditForm((current) => ({ ...current, scheduledTime: event.target.value }))} />
          <Input label="Quantity" type="number" min="1" value={editForm.quantity} onChange={(event) => setEditForm((current) => ({ ...current, quantity: event.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="button" onClick={() => void submitEdit()} loading={Boolean(editing && updatingId === editing.id)}>Save</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function MintHistoryTable({ rows, onSelect }: { rows: MintHistoryRow[]; onSelect: (row: MintHistoryRow) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left">
        <thead className="border-b border-border text-xs uppercase text-muted">
          <tr>
            <th className="px-5 py-3 font-medium">Collection Name</th>
            <th className="px-5 py-3 font-medium">Date & Time</th>
            <th className="px-5 py-3 font-medium">Wallet</th>
            <th className="px-5 py-3 font-medium">Quantity</th>
            <th className="px-5 py-3 font-medium">Cost</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Completion Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const status = mintStatus(row.status);
            return (
              <tr key={row.id} className="cursor-pointer hover:bg-white/5" onClick={() => onSelect(row)}>
                <td className="px-5 py-4 font-medium text-text">{collectionLabel(row)}</td>
                <td className="px-5 py-4 text-sm text-muted">{formatDate(row.executionStartedAt)}</td>
                <td className="px-5 py-4 text-sm text-muted">{walletLabel(row)}</td>
                <td className="px-5 py-4 font-mono text-sm text-text">{row.quantity}</td>
                <td className="px-5 py-4 font-mono text-sm text-text">{formatCost(row)}</td>
                <td className="px-5 py-4"><Badge variant={status.variant}>{status.label}</Badge></td>
                <td className="px-5 py-4 font-mono text-sm text-muted">{formatDuration(row.executionStartedAt, row.executionCompletedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScheduledTaskTable({
  rows,
  updatingId,
  onSelect,
  onEdit,
  onCancel,
  onDuplicate,
}: {
  rows: ScheduledTaskRow[];
  updatingId: string | null;
  onSelect: (row: ScheduledTaskRow) => void;
  onEdit: (row: ScheduledTaskRow) => void;
  onCancel: (row: ScheduledTaskRow) => void;
  onDuplicate: (row: ScheduledTaskRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-left">
        <thead className="border-b border-border text-xs uppercase text-muted">
          <tr>
            <th className="px-5 py-3 font-medium">Collection Name</th>
            <th className="px-5 py-3 font-medium">Scheduled Time</th>
            <th className="px-5 py-3 font-medium">Wallet</th>
            <th className="px-5 py-3 font-medium">Quantity</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const status = scheduledStatus(row.status);
            return (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-5 py-4 font-medium text-text">{collectionLabel(row)}</td>
                <td className="px-5 py-4">
                  <p className="text-sm text-text">{formatDate(row.scheduledTime)}</p>
                  <p className="mt-1 text-xs text-muted">{formatCountdown(row.scheduledTime)}</p>
                </td>
                <td className="px-5 py-4 text-sm text-muted">{walletLabel(row)}</td>
                <td className="px-5 py-4 font-mono text-sm text-text">{row.quantity}</td>
                <td className="px-5 py-4"><Badge variant={status.variant}>{status.label}</Badge></td>
                <td className="px-5 py-4">
                  <div className="flex gap-1">
                    <IconButton label="View" icon={Eye} onClick={() => onSelect(row)} />
                    <IconButton label="Edit" icon={Pencil} onClick={() => onEdit(row)} disabled={updatingId === row.id} />
                    <IconButton label="Cancel" icon={Trash2} onClick={() => onCancel(row)} disabled={updatingId === row.id || row.status === 'cancelled' || row.status === 'completed'} />
                    <IconButton label="Duplicate" icon={Copy} onClick={() => onDuplicate(row)} disabled={updatingId === row.id} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AnalyzerHistoryTable({
  rows,
  updatingId,
  onSelect,
  onReanalyze,
}: {
  rows: AnalyzerHistoryRow[];
  updatingId: string | null;
  onSelect: (row: AnalyzerHistoryRow) => void;
  onReanalyze: (row: AnalyzerHistoryRow) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1180px] text-left">
        <thead className="border-b border-border text-xs uppercase text-muted">
          <tr>
            <th className="px-5 py-3 font-medium">Collection Name</th>
            <th className="px-5 py-3 font-medium">Contract Address</th>
            <th className="px-5 py-3 font-medium">Chain</th>
            <th className="px-5 py-3 font-medium">Risk Score</th>
            <th className="px-5 py-3 font-medium">Market Status</th>
            <th className="px-5 py-3 font-medium">Floor</th>
            <th className="px-5 py-3 font-medium">Owners</th>
            <th className="px-5 py-3 font-medium">Opportunity Score</th>
            <th className="px-5 py-3 font-medium">Readiness</th>
            <th className="px-5 py-3 font-medium">Provider Used</th>
            <th className="px-5 py-3 font-medium">Cache</th>
            <th className="px-5 py-3 font-medium">RPC Provider</th>
            <th className="px-5 py-3 font-medium">Socials</th>
            <th className="px-5 py-3 font-medium">Analysis Duration</th>
            <th className="px-5 py-3 font-medium">Date</th>
            <th className="px-5 py-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            return (
              <tr key={row.id} className="hover:bg-white/5">
                <td className="px-5 py-4 font-medium text-text">{collectionLabel(row)}</td>
                <td className="px-5 py-4 font-mono text-sm text-muted">{shortAddress(row.contractAddress)}</td>
                <td className="px-5 py-4 text-sm capitalize text-muted">{row.chain}</td>
                <td className="px-5 py-4">
                  <Badge variant={riskBadgeVariant(row.riskLevel)}>{typeof row.riskScore === 'number' ? `${row.riskScore} ${row.riskLevel}` : row.riskLevel}</Badge>
                </td>
                <td className="px-5 py-4 text-sm text-muted">{formatMetric(row.marketStatus)}</td>
                <td className="px-5 py-4 font-mono text-sm text-text">{formatFloorPrice(row)}</td>
                <td className="px-5 py-4 font-mono text-sm text-text">{formatMetric(row.ownerCount)}</td>
                <td className="px-5 py-4 font-mono text-sm text-text">{row.opportunityScore}</td>
                <td className="px-5 py-4 font-mono text-sm text-text">{row.readinessScore}%</td>
                <td className="px-5 py-4 text-sm text-muted">{row.providerUsed}</td>
                <td className="px-5 py-4 text-sm text-muted">{row.cacheUsed ? 'Used' : 'Missed'}</td>
                <td className="px-5 py-4 text-sm text-muted">{row.rpcProviderUsed ?? 'Not used'}</td>
                <td className="px-5 py-4 font-mono text-sm text-text">{row.socialCount}</td>
                <td className="px-5 py-4 font-mono text-sm text-muted">{formatMilliseconds(row.analysisDurationMs)}</td>
                <td className="px-5 py-4 text-sm text-muted">{formatDate(row.createdAt)}</td>
                <td className="px-5 py-4">
                  <div className="flex gap-1">
                    <IconButton label="View Analysis" icon={Eye} onClick={() => onSelect(row)} />
                    <IconButton label="Reanalyze" icon={RefreshCcw} onClick={() => onReanalyze(row)} disabled={updatingId === row.id || !row.contractAddress} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IconButton({ label, icon: Icon, onClick, disabled }: { label: string; icon: typeof Eye; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-text disabled:opacity-50"
      aria-label={label}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function DetailsModal({ selected, onClose }: { selected: SelectedRow; onClose: () => void }) {
  if (!selected) return null;

  if (selected.type === 'mint') {
    const item = selected.item;
    const status = mintStatus(item.status);
    return (
      <Modal open title="Mint Details" onClose={onClose}>
        <DetailGrid rows={[
          ['Collection', collectionLabel(item)],
          ['Wallet', walletLabel(item)],
          ['Quantity', String(item.quantity)],
          ['Cost', formatCost(item)],
          ['Status', status.label],
          ['Transaction Hash', item.transactionHash || 'Not recorded'],
          ['Execution Started', formatDate(item.executionStartedAt)],
          ['Execution Completed', formatDate(item.executionCompletedAt)],
          ['Completion Time', formatDuration(item.executionStartedAt, item.executionCompletedAt)],
        ]} />
      </Modal>
    );
  }

  if (selected.type === 'scheduled') {
    const item = selected.item;
    const status = scheduledStatus(item.status);
    return (
      <Modal open title="Scheduled Task" onClose={onClose}>
        <DetailGrid rows={[
          ['Collection', collectionLabel(item)],
          ['Scheduled Time', formatDate(item.scheduledTime)],
          ['Countdown', formatCountdown(item.scheduledTime)],
          ['Wallet', walletLabel(item)],
          ['Quantity', String(item.quantity)],
          ['Status', status.label],
        ]} />
      </Modal>
    );
  }

  const item = selected.item;
  return (
    <Modal open title="Analyzer Details" onClose={onClose}>
      <DetailGrid rows={[
        ['Collection', collectionLabel(item)],
        ['Contract', item.contractAddress || 'Not recorded'],
        ['Chain', item.chain],
        ['Risk Score', typeof item.riskScore === 'number' ? `${item.riskScore} ${item.riskLevel}` : item.riskLevel],
        ['Risk Factors', item.riskFactors?.length ? item.riskFactors.join(', ') : 'None recorded'],
        ['Floor Price', formatFloorPrice(item)],
        ['Owner Count', formatMetric(item.ownerCount)],
        ['Volume', formatMetric(item.volume)],
        ['Market Status', formatMetric(item.marketStatus)],
        ['Health Score', item.healthScore === null ? 'Unavailable' : `${item.healthScore}/100`],
        ['Opportunity Score', String(item.opportunityScore)],
        ['Readiness', `${item.readinessScore}%`],
        ['Mint State', item.mintState],
        ['Provider Used', item.providerUsed],
        ['Cache Used', item.cacheUsed ? 'YES' : 'NO'],
        ['RPC Provider', item.rpcProviderUsed ?? 'Not used'],
        ['Detected Socials', String(item.socialCount)],
        ['Social Links', formatSocials(item.socials)],
        ['Analysis Duration', formatMilliseconds(item.analysisDurationMs)],
        ['Date', formatDate(item.createdAt)],
        ['Input', item.input],
        ['Source URL', item.sourceUrl],
      ]} />
    </Modal>
  );
}
