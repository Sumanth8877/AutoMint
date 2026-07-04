'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  CalendarClock, LinkIcon, Play, Plus, RotateCcw,
  Trash2, XCircle, Zap, CheckCircle2, AlertCircle, Cpu, ExternalLink, Terminal,
} from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { SkeletonCard } from '@/components/ui/skeleton';
import { Stagger, StaggerItem } from '@/components/motion';
import { apiRequest } from '@/lib/api/client';
import { isValidMintInput } from '@/lib/validation';
import type { WalletType } from '@/lib/wallets/detection';

type MintTask = {
  id: string; walletId: string | null; collectionId: string | null;
  quantity: number; status: string; contractAddress: string | null;
  collectionName: string | null;
  mintPrice: string | null; scheduledTime: string | null;
  phase: 'whitelist' | 'allowlist' | 'public' | null;
  riskReasons: string[] | null; failureReason: string | null;
  qstashMessageId: string | null; createdAt: string; confirmedAt: string | null;
};

type WalletRecord = { id: string; address: string; nickname: string | null; chain: string; walletType: WalletType; isDefault: boolean; };
type MintsForm = { mintUrl: string; wlMode: boolean };
type MintsState = {
  saving: boolean; updatingId: string | null; deletingId: string | null;
  queueOpen: boolean; error: string | null; success: string | null;
  formError: string | null; form: MintsForm; consoleTaskId: string | null;
};
type MintsAction =
  | { type: 'START_SAVING' } | { type: 'STOP_SAVING' }
  | { type: 'SET_UPDATING_ID'; id: string | null } | { type: 'SET_DELETING_ID'; id: string | null }
  | { type: 'OPEN_QUEUE' } | { type: 'CLOSE_QUEUE' }
  | { type: 'OPEN_CONSOLE'; id: string } | { type: 'CLOSE_CONSOLE' }
  | { type: 'SET_ERROR'; message: string | null } | { type: 'SET_SUCCESS'; message: string | null }
  | { type: 'SET_FORM_ERROR'; message: string | null }
  | { type: 'PATCH_FORM'; patch: Partial<MintsForm> } | { type: 'RESET_FORM' };

const initialState: MintsState = {
  saving: false, updatingId: null, deletingId: null, queueOpen: false,
  error: null, success: null, formError: null, consoleTaskId: null,
  form: { mintUrl: '', wlMode: false },
};

function reducer(state: MintsState, action: MintsAction): MintsState {
  switch (action.type) {
    case 'START_SAVING': return { ...state, saving: true, formError: null };
    case 'STOP_SAVING':  return { ...state, saving: false };
    case 'SET_UPDATING_ID': return { ...state, updatingId: action.id };
    case 'SET_DELETING_ID': return { ...state, deletingId: action.id };
    case 'OPEN_QUEUE':  return { ...state, queueOpen: true, formError: null };
    case 'CLOSE_QUEUE': return { ...state, queueOpen: false, formError: null };
    case 'OPEN_CONSOLE': return { ...state, consoleTaskId: action.id };
    case 'CLOSE_CONSOLE': return { ...state, consoleTaskId: null };
    case 'SET_ERROR':   return { ...state, error: action.message };
    case 'SET_SUCCESS': return { ...state, success: action.message };
    case 'SET_FORM_ERROR': return { ...state, formError: action.message };
    case 'PATCH_FORM':  return { ...state, form: { ...state.form, ...action.patch } };
    case 'RESET_FORM':  return { ...state, form: initialState.form };
    default: return state;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'completed':  return <Badge variant="success" dot pulse={false}>Completed</Badge>;
    case 'confirmed':  return <Badge variant="success" dot>Confirmed</Badge>;
    case 'pending':    return <Badge variant="warning" dot pulse>Pending</Badge>;
    case 'monitoring': return <Badge variant="neon" dot pulse>Monitoring</Badge>;
    case 'ready':      return <Badge variant="neon" dot>Ready</Badge>;
    case 'failed':     return <Badge variant="danger" dot>Failed</Badge>;
    case 'cancelled':  return <Badge variant="default" dot>Cancelled</Badge>;
    default:            return <Badge variant="default">{status}</Badge>;
  }
}

function shortAddress(addr: string | null) {
  if (!addr) return 'Unknown';
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function formatDuration(ms: number) {
  if (ms < 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/** Compute elapsed time from task creation to completion/failure, or until now if still active. */
function taskDuration(task: MintTask): { label: string; value: string } | null {
  const startedAt = new Date(task.createdAt).getTime();
  if (isNaN(startedAt)) return null;

  const isActive = ['pending', 'monitoring', 'ready', 'running', 'unconfirmed'].includes(task.status);
  const endedAt = task.confirmedAt
    ? new Date(task.confirmedAt).getTime()
    : !isActive
      ? Date.now() // fallback for failed/cancelled without confirmedAt
      : Date.now();

  if (isActive && !task.confirmedAt) {
    return { label: 'Elapsed', value: formatDuration(endedAt - startedAt) };
  }
  if (task.confirmedAt) {
    return { label: 'Completed in', value: formatDuration(endedAt - startedAt) };
  }
  if (task.status === 'failed') {
    return { label: 'Failed in', value: formatDuration(endedAt - startedAt) };
  }
  if (task.status === 'cancelled') {
    return { label: 'Cancelled in', value: formatDuration(endedAt - startedAt) };
  }
  return null;
}

function MintRow({
  task, wallets, onStart, onCancel, onDelete, onOpenConsole, updatingId, deletingId,
}: {
  task: MintTask; wallets: WalletRecord[];
  onStart: (id: string) => void; onCancel: (id: string) => void; onDelete: (id: string) => void;
  onOpenConsole: (id: string) => void;
  updatingId: string | null; deletingId: string | null;
}) {
  const wallet = wallets.find(w => w.id === task.walletId);
  const canPlay  = ['pending', 'ready'].includes(task.status) && !task.qstashMessageId;
  const canCancel = ['pending', 'monitoring', 'ready'].includes(task.status);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenConsole(task.id)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onOpenConsole(task.id); }}
      className="group relative flex cursor-pointer flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-all duration-200 hover:border-border-strong hover:bg-surface-hover sm:flex-row sm:items-center"
    >
      {/* Status indicator strip */}
      <div className={`absolute left-0 top-4 bottom-4 w-0.5 rounded-full ${
        task.status === 'completed' || task.status === 'confirmed' ? 'bg-success shadow-[0_0_8px_rgba(79,70,229,0.5)]' :
        task.status === 'monitoring' || task.status === 'ready' ? 'bg-primary shadow-[0_0_8px_rgba(79,70,229,0.5)]' :
        task.status === 'pending' ? 'bg-warning shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
        task.status === 'failed' ? 'bg-danger shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
        'bg-muted'
      }`} />

      {/* Contract icon */}
      <div className="ml-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface">
        <Zap className="h-4 w-4 text-primary" />
      </div>

      {/* Main info */}
      <div className="ml-3 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-text">
            {task.collectionName || shortAddress(task.contractAddress)}
          </span>
          {statusBadge(task.status)}
          {task.phase && <Badge variant="purple">{task.phase}</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
          {wallet && <span>🔑 {wallet.nickname ?? `${wallet.address.slice(0, 6)}…`}</span>}
          <span>×{task.quantity}</span>
          {task.mintPrice && <span>⚡ {task.mintPrice} ETH</span>}
          {task.scheduledTime && (
            <span className="flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />
              {new Date(task.scheduledTime).toLocaleString()}
            </span>
          )}
          {(() => {
            const dur = taskDuration(task);
            return dur && (
              <span className="rounded-full border border-border bg-surface-hover px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                {dur.label}: {dur.value}
              </span>
            );
          })()}
          <span className="text-muted/60">{new Date(task.createdAt).toLocaleDateString()}</span>
        </div>
        {task.failureReason && (
          <p className="mt-1.5 text-xs text-danger bg-red-50 rounded px-2 py-1 border border-danger/15">
            ⚠ {task.failureReason}
          </p>
        )}
        {task.riskReasons && task.riskReasons.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {task.riskReasons.map(r => (
              <span key={r} className="text-xs rounded px-1.5 py-0.5 bg-amber-50 text-warning border border-warning/15">{r}</span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="ml-3 flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
        {canPlay && (
          <Button
            variant="neon"
            size="sm"
            onClick={() => onStart(task.id)}
            loading={updatingId === task.id}
            disabled={!!updatingId}
          >
            <Play className="h-3 w-3" />
            Mint
          </Button>
        )}
        {canCancel && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCancel(task.id)}
            loading={updatingId === task.id && !canPlay}
            disabled={!!updatingId}
          >
            <XCircle className="h-3 w-3" />
          </Button>
        )}
        {task.status === 'failed' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onStart(task.id)}
            loading={updatingId === task.id}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(task.id)}
          loading={deletingId === task.id}
          disabled={!!deletingId || !!updatingId}
          className="text-muted hover:text-danger"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
        <button
          type="button"
          onClick={() => onOpenConsole(task.id)}
          title="View live task console"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
        >
          <Terminal className="h-3.5 w-3.5" />
        </button>
        {task.contractAddress && (
          <a
            href={`https://etherscan.io/address/${task.contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-text hover:bg-surface-hover transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

type TaskLogEntry = { id: string; event: string; status: string; message: string | null; createdAt: string };

function logLineTone(status: string) {
  switch (status) {
    case 'error':   return 'text-red-400';
    case 'warning': return 'text-amber-400';
    case 'success': return 'text-emerald-400';
    default:        return 'text-slate-300';
  }
}

function TaskConsole({ taskId, task, onClose, onStart, updatingId }: {
  taskId: string;
  task: MintTask | undefined;
  onClose: () => void;
  onStart: (id: string) => void;
  updatingId: string | null;
}) {
  const { data: logs = [], isFetching } = useQuery<TaskLogEntry[]>({
    queryKey: ['mint-logs', taskId],
    queryFn: () => apiRequest<{ logs: TaskLogEntry[] }>(`/api/mints/${taskId}/logs`).then(r => r.logs ?? []),
    // Live tail: poll every 2s while the console is open so the user can watch
    // a mint execute in real time (risk check -> broadcast -> confirmation).
    refetchInterval: 2000,
  });

  const isActive = task ? ['pending', 'monitoring', 'ready', 'running', 'unconfirmed'].includes(task.status) : false;
  const canRetry = task?.status === 'failed';

  // Real, measured "queued -> confirmed" timing — no estimates. task.createdAt
  // is the moment the task was created (right after URL/contract resolution).
  // task.confirmedAt is set by executeMintTask() the instant the receipt comes
  // back on-chain. While still active we tick against the latest log entry
  // (or now) so you can watch the live elapsed time count up in real time.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => setNowTick(Date.now()), 100);
    return () => clearInterval(interval);
  }, [isActive]);

  const startedAt = task ? new Date(task.createdAt).getTime() : null;
  const lastLogAt = logs.length > 0 ? new Date(logs[logs.length - 1].createdAt).getTime() : null;
  const endedAt = task?.confirmedAt ? new Date(task.confirmedAt).getTime() : (!isActive ? lastLogAt : null);
  const elapsedMs = startedAt != null ? (endedAt ?? nowTick) - startedAt : null;
  const elapsedLabel = task?.confirmedAt ? 'Confirmed in' : isActive ? 'Elapsed' : 'Time to failure';

  return (
    <Modal
      open={!!taskId}
      onClose={onClose}
      title="Task Console"
      subtitle={task?.collectionName || (task?.contractAddress ? shortAddress(task.contractAddress) : 'Live execution log')}
      tone="neon"
      size="xl"
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {task && statusBadge(task.status)}
            {isActive && (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                Live{isFetching ? '…' : ''}
              </span>
            )}
            {elapsedMs != null && (
              <span className="rounded-full border border-primary/20 bg-indigo-50 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                {elapsedLabel}: {formatDuration(elapsedMs)}
              </span>
            )}
          </div>
          {canRetry && (
            <Button variant="ghost" size="sm" onClick={() => onStart(taskId)} loading={updatingId === taskId}>
              <RotateCcw className="h-3 w-3" />
              Retry
            </Button>
          )}
        </div>
        <div className="h-96 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-slate-500">Waiting for task activity…</p>
          ) : (
            logs.map(log => (
              <div key={log.id} className="flex gap-2 py-0.5">
                <span className="shrink-0 text-slate-600">{new Date(log.createdAt).toLocaleTimeString()}</span>
                <span className={`shrink-0 uppercase ${logLineTone(log.status)}`}>[{log.event}]</span>
                <span className="text-slate-200">{log.message ?? ''}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function MintsClient() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<MintTask[]>({
    queryKey: ['mints'],
    queryFn: () => apiRequest<{ tasks: MintTask[] }>('/api/mints').then(r => r.tasks ?? []),
    refetchInterval: 6000,
  });

  const { data: wallets = [] } = useQuery<WalletRecord[]>({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<{ wallets: WalletRecord[] }>('/api/wallets').then(r => r.wallets ?? []),
  });

  const createMint = useMutation({
    mutationFn: (body: object) => apiRequest('/api/mints', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mints'] });
      dispatch({ type: 'STOP_SAVING' });
      dispatch({ type: 'CLOSE_QUEUE' });
      dispatch({ type: 'RESET_FORM' });
      dispatch({ type: 'SET_SUCCESS', message: 'Mint queued successfully' });
      setTimeout(() => dispatch({ type: 'SET_SUCCESS', message: null }), 4000);
    },
    onError: (e: Error) => {
      dispatch({ type: 'STOP_SAVING' });
      dispatch({ type: 'SET_FORM_ERROR', message: e.message });
    },
  });

  const updateTask = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      apiRequest('/api/mints', { method: 'PATCH', body: JSON.stringify({ id, action }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['mints'] }); dispatch({ type: 'SET_UPDATING_ID', id: null }); },
    onError: (e: Error) => { dispatch({ type: 'SET_UPDATING_ID', id: null }); dispatch({ type: 'SET_ERROR', message: e.message }); },
  });

  const deleteTask = useMutation({
    mutationFn: (id: string) => apiRequest('/api/mints', { method: 'DELETE', body: JSON.stringify({ id }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['mints'] }); dispatch({ type: 'SET_DELETING_ID', id: null }); },
    onError: (e: Error) => { dispatch({ type: 'SET_DELETING_ID', id: null }); dispatch({ type: 'SET_ERROR', message: e.message }); },
  });

  useEffect(() => {
    const url = searchParams.get('mintUrl');
    if (url) { dispatch({ type: 'PATCH_FORM', patch: { mintUrl: url } }); dispatch({ type: 'OPEN_QUEUE' }); }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedUrl = state.form.mintUrl.trim();
    if (wallets.length === 0) {
      dispatch({ type: 'SET_FORM_ERROR', message: 'No wallet found. Add a wallet in Settings before queuing a mint.' });
      return;
    }
    if (!trimmedUrl) { dispatch({ type: 'SET_FORM_ERROR', message: 'Mint URL or contract address is required.' }); return; }
    if (!isValidMintInput(trimmedUrl)) { dispatch({ type: 'SET_FORM_ERROR', message: 'Enter a valid URL or 0x contract address.' }); return; }
    dispatch({ type: 'START_SAVING' });
    createMint.mutate({ mintUrl: trimmedUrl, wlMode: state.form.wlMode });
  }

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return tasks;
    return tasks.filter(t => t.status === filterStatus);
  }, [tasks, filterStatus]);

  const stats = useMemo(() => ({
    active:    tasks.filter(t => ['pending', 'monitoring', 'ready'].includes(t.status)).length,
    completed: tasks.filter(t => ['completed', 'confirmed'].includes(t.status)).length,
    failed:    tasks.filter(t => t.status === 'failed').length,
  }), [tasks]);

  const statusFilters = ['all', 'pending', 'monitoring', 'completed', 'failed'];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Mint Queue"
        subtitle="Automated NFT minting engine"
        icon={Zap}
        iconTone="gold"
        actions={
          <Button variant="gold" glow onClick={() => dispatch({ type: 'OPEN_QUEUE' })}>
            <Plus className="h-3.5 w-3.5" />
            Queue Mint
          </Button>
        }
      />

      {/* Status banner */}
      {state.success && (
        <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
          <p className="text-sm text-success">{state.success}</p>
        </div>
      )}
      {state.error && (
        <div className="flex items-center gap-3 rounded-xl border border-danger/20 bg-red-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-danger shrink-0" />
          <p className="text-sm text-danger">{state.error}</p>
        </div>
      )}

      {/* Metrics */}
      <Stagger className="grid gap-4 sm:grid-cols-3" inView>
        <StaggerItem><MetricCard label="Active" value={stats.active} icon={Cpu} tone="neon" /></StaggerItem>
        <StaggerItem><MetricCard label="Completed" value={stats.completed} icon={CheckCircle2} tone="success" /></StaggerItem>
        <StaggerItem><MetricCard label="Failed" value={stats.failed} icon={AlertCircle} tone="danger" /></StaggerItem>
      </Stagger>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {statusFilters.map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-150 ${
              filterStatus === s
                ? 'bg-indigo-50 text-primary border border-primary/20'
                : 'text-muted hover:text-secondary hover:bg-surface-hover'
            }`}
          >
            {s === 'all' ? `All (${tasks.length})` : `${s} (${tasks.filter(t => t.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Risk warning banner */}
      {tasks.some(t => t.riskReasons?.length && ['pending', 'monitoring', 'ready', 'running'].includes(t.status)) && (
        <div className="mb-4 flex items-center gap-4 rounded-xl border border-amber-300/30 bg-amber-50 p-4">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
            <Image src="/illustrations/risk-warning.jpeg" alt="A small character holding up a warning sign" fill sizes="64px" className="object-contain" />
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-800">Risk Detected</p>
            <p className="text-xs text-amber-700">Some active mints have risk flags. Review risk reasons before execution.</p>
          </div>
        </div>
      )}

      {/* Mint list */}
      <div className="space-y-3">
        {tasksLoading ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)
        ) : filtered.length === 0 ? (
          filterStatus !== 'all' && tasks.length > 0 ? (
            <EmptyState
              image="/illustrations/mint-scheduled.jpeg"
              imageAlt="A small character turning a giant kitchen-timer dial, setting it to T equals zero — queued and waiting."
              title={`No ${filterStatus} mints`}
              description={`You have ${tasks.length} mint task${tasks.length === 1 ? '' : 's'} in other states. Switch filters or queue a new mint.`}
            />
          ) : (
            <EmptyState
              image="/illustrations/empty-mints.jpeg"
              imageAlt="A character sitting on an empty inbox tray, holding a MINT sign above an empty URL bar."
              title="No mints in queue"
              description="Queue a mint URL to get started. AutoMint will analyze the contract and execute automatically the moment the mint opens."
            />
          )
        ) : (
          <>
            {filterStatus === 'completed' && filtered.length > 0 && (
              <div className="mb-6 flex items-center gap-4 rounded-xl border border-success/20 bg-emerald-50 p-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl">
                  <Image src="/illustrations/mint-success-trophy.jpeg" alt="A small character celebrating with a golden trophy" fill sizes="80px" className="object-contain" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text">Mints Completed</p>
                  <p className="text-xs text-muted">{filtered.length} mint{filtered.length !== 1 ? 's' : ''} successfully executed. Your collection is growing.</p>
                </div>
              </div>
            )}
          <Stagger className="space-y-3" stagger={0.05}>
            {filtered.map(task => (
              <StaggerItem key={task.id}>
                <MintRow
                  task={task}
                  wallets={wallets}
                  onStart={id => { dispatch({ type: 'SET_UPDATING_ID', id }); updateTask.mutate({ id, action: 'start' }); }}
                  onCancel={id => { dispatch({ type: 'SET_UPDATING_ID', id }); updateTask.mutate({ id, action: 'cancel' }); }}
                  onDelete={id => { dispatch({ type: 'SET_DELETING_ID', id }); deleteTask.mutate(id); }}
                  onOpenConsole={id => dispatch({ type: 'OPEN_CONSOLE', id })}
                  updatingId={state.updatingId}
                  deletingId={state.deletingId}
                />
              </StaggerItem>
            ))}
          </Stagger>
          </>
        )}
      </div>

      {/* Queue modal */}
      <Modal open={state.queueOpen} onClose={() => dispatch({ type: 'CLOSE_QUEUE' })} title="Queue Mint" subtitle="AutoMint will analyze and execute this contract automatically." tone="neon" size="md">
        <form onSubmit={handleSubmit} className="space-y-5">
          <Input
            label="Mint URL or Contract Address"
            placeholder="https://mint.xyz/... or 0x..."
            value={state.form.mintUrl}
            onChange={e => dispatch({ type: 'PATCH_FORM', patch: { mintUrl: e.target.value } })}
            leftIcon={<LinkIcon className="h-3.5 w-3.5" />}
            error={state.formError ?? undefined}
            required
          />

          <div className="flex items-center justify-between rounded-xl border border-border bg-surface-hover p-4">
            <div>
              <p className="text-sm font-bold text-text">Whitelist Mode</p>
              <p className="text-xs text-muted mt-0.5">Targets the WL/allowlist phase timing &amp; price only</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={state.form.wlMode}
              onClick={() => dispatch({ type: 'PATCH_FORM', patch: { wlMode: !state.form.wlMode } })}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                state.form.wlMode ? 'bg-primary/30 border border-primary/50' : 'bg-surface-hover border border-border'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full transition-transform duration-200 ${
                  state.form.wlMode ? 'translate-x-6 bg-primary shadow-[0_0_8px_rgba(79,70,229,0.5)]' : 'translate-x-1 bg-muted'
                }`}
              />
            </button>
          </div>

          {state.form.wlMode && (
            <p className="-mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Proof-based allowlist minting isn&apos;t supported yet. This only targets the WL/allowlist
                phase&apos;s timing &amp; price. If the contract requires an allowlist Merkle proof or signed
                voucher, the mint is rejected before it&apos;s queued instead of failing on-chain.
              </span>
            </p>
          )}

          <p className="flex items-start gap-1.5 rounded-lg border border-border/60 bg-surface-hover px-3 py-2 text-[11px] leading-relaxed text-muted">
            <CalendarClock className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <span>
              Mint time is auto-detected from the URL. No manual scheduling needed &mdash; AutoMint reads the
              collection, extracts the phase timing, and fires the moment it opens.
            </span>
          </p>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => dispatch({ type: 'CLOSE_QUEUE' })} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" variant="neon" loading={state.saving} className="flex-1" glow>
              <Zap className="h-3.5 w-3.5" />
              {state.saving ? 'Queueing...' : 'Queue Now'}
            </Button>
          </div>
        </form>
      </Modal>

      {state.consoleTaskId && (
        <TaskConsole
          taskId={state.consoleTaskId}
          task={tasks.find(t => t.id === state.consoleTaskId)}
          onClose={() => dispatch({ type: 'CLOSE_CONSOLE' })}
          onStart={id => { dispatch({ type: 'SET_UPDATING_ID', id }); updateTask.mutate({ id, action: 'start' }); }}
          updatingId={state.updatingId}
        />
      )}
    </div>
  );
}
