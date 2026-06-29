'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { CalendarClock, LinkIcon, MoreHorizontal, Play, Plus, RotateCcw, Trash2, XCircle, Zap } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/empty-state';
import { MetricCard } from '@/components/ui/metric-card';
import { Modal } from '@/components/ui/modal';
import { PageHeader } from '@/components/ui/page-header';
import { TaskConsole } from '@/components/ui/task-console';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/api/client';
import type { WalletType } from '@/lib/wallets/detection';

type MintTask = {
  id: string;
  walletId: string | null;
  collectionId: string | null;
  quantity: number;
  status: string;
  contractAddress: string | null;
  mintPrice: string | null;
  scheduledTime: string | null;       // when upcoming mint will fire
  phase: 'whitelist' | 'allowlist' | 'public' | null;  // which mint phase this task targets
  riskReasons: string[] | null;       // risk-analysis notes (NOT the exec error)
  failureReason: string | null;       // real execution error from task logs
  qstashMessageId: string | null;     // set when QStash is handling execution — hide play button
  createdAt: string;
};

type WalletRecord = {
  id: string;
  address: string;
  nickname: string | null;
  chain: string;
  walletType: WalletType;
  isDefault: boolean;
};

type CollectionRecord = {
  id: string;
  name: string | null;
  contractAddress: string;
  chain: string;
};

type MintActionResponse = {
  task: MintTask;
  collection?: CollectionRecord;
  analyzerRequired?: boolean;
  mintStatus?: 'live' | 'upcoming' | 'monitoring';
  scheduledTime?: string | null;
  /** true when the server auto-scheduled execution (no manual play click needed) */
  autoTriggered?: boolean;
  /** which non-public phase was targeted in WL mode */
  wlPhase?: string;
  result?: {
    success: boolean;
    txHash?: string;
    error?: string;
  };
};

// ---------------------------------------------------------------------------
// Reducer — replaces 10 individual useState calls.
// Grouping related state here makes impossible UI states explicit:
//   e.g. saving=true and analyzing=true simultaneously is now impossible
//   because both are set via dispatched actions, not ad-hoc setters.
// ---------------------------------------------------------------------------

type MintsForm = { mintUrl: string; wlMode: boolean; scheduleTime: string };

type MintsState = {
  /** True while the create-mint POST is in-flight */
  saving: boolean;
  /** ID of the task currently being started/cancelled, or null */
  updatingId: string | null;
  /** ID of the task currently being deleted, or null */
  deletingId: string | null;
  /** Whether the Queue Settings modal is open */
  queueOpen: boolean;
  /** Top-level error banner (fetch/mutation failures) */
  error: string | null;
  /** Top-level success banner (task created confirmations) */
  success: string | null;
  /** Inline form error shown inside the modal */
  formError: string | null;
  /** Controlled form values */
  form: MintsForm;
};

type MintsAction =
  | { type: 'START_SAVING' }
  | { type: 'STOP_SAVING' }
  | { type: 'SET_UPDATING_ID'; id: string | null }
  | { type: 'SET_DELETING_ID'; id: string | null }
  | { type: 'OPEN_QUEUE' }
  | { type: 'CLOSE_QUEUE' }
  | { type: 'SET_ERROR'; message: string | null }
  | { type: 'SET_SUCCESS'; message: string | null }
  | { type: 'SET_FORM_ERROR'; message: string | null }
  | { type: 'PATCH_FORM'; patch: Partial<MintsForm> }
  | { type: 'RESET_FORM' };

const initialState: MintsState = {
  saving: false,
  updatingId: null,
  deletingId: null,
  queueOpen: false,
  error: null,
  success: null,
  formError: null,
  form: { mintUrl: '', wlMode: false, scheduleTime: '' },
};

function mintsReducer(state: MintsState, action: MintsAction): MintsState {
  switch (action.type) {
    case 'START_SAVING':    return { ...state, saving: true };
    case 'STOP_SAVING':     return { ...state, saving: false };
    case 'SET_UPDATING_ID': return { ...state, updatingId: action.id };
    case 'SET_DELETING_ID': return { ...state, deletingId: action.id };
    case 'OPEN_QUEUE':      return { ...state, queueOpen: true };
    case 'CLOSE_QUEUE':     return { ...state, queueOpen: false };
    case 'SET_ERROR':       return { ...state, error: action.message, success: null };
    case 'SET_SUCCESS':     return { ...state, success: action.message, error: null };
    case 'SET_FORM_ERROR':  return { ...state, formError: action.message };
    case 'PATCH_FORM':      return { ...state, form: { ...state.form, ...action.patch } };
    case 'RESET_FORM':      return {
      ...state,
      form: initialState.form,
      formError: null,
    };
    default: return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function statusVariant(status: string) {
  if (status === 'completed' || status === 'ready') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'running' || status === 'monitoring') return 'info';
  return 'warning';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ── CountdownTimer ─────────────────────────────────────────────────────────
// Live countdown for upcoming scheduled mints. Updates every second.
function CountdownTimer({ targetTime, monitoringStatus = false }: { targetTime: string; monitoringStatus?: boolean }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const tick = () => {
      const diff = new Date(targetTime).getTime() - Date.now();
      if (diff <= 30_000) {
        // scheduledTime is in the past or very near — show context-aware label
        setLabel(monitoringStatus ? '' : 'Executing now…');
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setLabel(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [targetTime, monitoringStatus]);
  if (!label && monitoringStatus) return null; // rendered by the monitoring fallback
  return <span className="font-mono tabular-nums">{label}</span>;
}

// ── ScheduleLabel ─────────────────────────────────────────────────────
// Shows "⚡ Executing now…" for ready tasks whose scheduledTime has
// passed (QStash delivery imminent), or the scheduled fire time otherwise.
// Uses a ref to snapshot "now" at mount so render stays pure.
function ScheduleLabel({ status, scheduledTime }: { status: string; scheduledTime: string }) {
  const [mountTime] = useState(() => Date.now());
  const ts = new Date(scheduledTime).getTime();
  const near = status === 'ready' && ts <= mountTime + 60_000;
  if (near) return <span>⚡ Executing now…</span>;
  const prefix = status === 'running' ? 'Executing' : 'Fires at';
  return <span>⏰ {prefix}: {new Date(scheduledTime).toLocaleString()}</span>;
}

export default function MintsClient() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(mintsReducer, initialState);
  const { saving, updatingId, deletingId, queueOpen, error, success, formError, form } = state;
  const [consoleTaskId, setConsoleTaskId] = useState<string | null>(null);

  // Fetch data with React Query
  const { data: mintsData, isLoading, error: fetchError } = useQuery({
    queryKey: ['mints'],
    queryFn: () => apiRequest<{ tasks: MintTask[] }>('/api/mints'),
    // Live polling — only while there are active (non-terminal) tasks
    refetchInterval: (query) => {
      const activeTasks = query.state.data?.tasks ?? [];
      return activeTasks.some(t =>
        ['pending', 'monitoring', 'ready', 'running', 'unconfirmed'].includes(t.status)
      ) ? 5000 : false;
    },
    refetchIntervalInBackground: false,
    staleTime: 3000,
  });

  const { data: walletsData } = useQuery({
    queryKey: ['wallets'],
    queryFn: () => apiRequest<{ wallets: WalletRecord[] }>('/api/wallets'),
  });

  const { data: collectionsData } = useQuery({
    queryKey: ['collections'],
    queryFn: () => apiRequest<{ collections: CollectionRecord[] }>('/api/collections'),
  });

  const tasks = useMemo(() => mintsData?.tasks ?? [], [mintsData?.tasks]);
  const wallets = useMemo(() => walletsData?.wallets ?? [], [walletsData?.wallets]);
  const collections = useMemo(() => collectionsData?.collections ?? [], [collectionsData?.collections]);

  const collectionById = useMemo(() => new Map(collections.map((collection) => [collection.id, collection])), [collections]);
  const walletById = useMemo(() => new Map(wallets.map((wallet) => [wallet.id, wallet])), [wallets]);
  const defaultWallet = useMemo(() => wallets.find((wallet) => wallet.isDefault), [wallets]);
  const runningCount = tasks.filter((task) => task.status === 'running').length;
  // 'ready' (strategy approved, QStash enqueued, about to fire) is a brief
  // intermediate state — count it as Queued rather than its own card.
  const queuedCount = tasks.filter((task) => task.status === 'pending' || task.status === 'monitoring' || task.status === 'ready').length;
  const retryCount = tasks.filter((task) => task.status === 'failed').length;

  // Handle mintUrl from URL params and set default wallet
  useEffect(() => {
    const mintUrlParam = searchParams.get('mintUrl');
    if (mintUrlParam) {
      dispatch({ type: 'PATCH_FORM', patch: { mintUrl: mintUrlParam } });
    }
  }, [searchParams]);

  // Mirror React Query fetch failures into the error banner
  useEffect(() => {
    if (fetchError) {
      dispatch({
        type: 'SET_ERROR',
        message: fetchError instanceof Error ? fetchError.message : 'Failed to load mint data.',
      });
    }
  }, [fetchError]);

  // Auto-dismiss the success banner after a few seconds. It reflects the state
  // at submit time (e.g. "⚡ auto-executing now") — the task table below is the
  // live source of truth. Without this, a transient "executing" banner lingers
  // and contradicts a task that has already failed (e.g. balance too low).
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => dispatch({ type: 'SET_SUCCESS', message: null }), 6000);
    return () => clearTimeout(timer);
  }, [success]);

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (data: { mintUrl: string; quantity: number; wlMode?: boolean }) => {
      return apiRequest<MintActionResponse>('/api/mints', {
        method: 'POST',
        body: data,
      });
    },
    onSuccess: (payload) => {
      queryClient.invalidateQueries({ queryKey: ['mints'] });
      if (payload.collection) {
        queryClient.invalidateQueries({ queryKey: ['collections'] });
      }
    },
  });

  // Start task mutation
  const startTaskMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      return apiRequest<MintActionResponse>('/api/mints', {
        method: 'PATCH',
        body: { id, action },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mints'] });
    },
  });

  // Cancel task mutation — optimistic: flip status to 'cancelled' immediately, rollback on error
  const cancelTaskMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      return apiRequest<MintActionResponse>('/api/mints', {
        method: 'PATCH',
        body: { id, action },
      });
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['mints'] });
      const previous = queryClient.getQueryData<{ tasks: MintTask[] }>(['mints']);
      queryClient.setQueryData<{ tasks: MintTask[] }>(['mints'], (old) => ({
        tasks: (old?.tasks ?? []).map((t) => t.id === id ? { ...t, status: 'cancelled' } : t),
      }));
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['mints'], context.previous);
      dispatch({ type: 'SET_ERROR', message: 'Failed to cancel task.' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['mints'] });
      dispatch({ type: 'SET_UPDATING_ID', id: null });
    },
  });

  // Delete task mutation — optimistic: remove from list immediately, rollback on error
  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest<{ success: true }>('/api/mints', {
        method: 'DELETE',
        body: { id },
      });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['mints'] });
      const previous = queryClient.getQueryData<{ tasks: MintTask[] }>(['mints']);
      queryClient.setQueryData<{ tasks: MintTask[] }>(['mints'], (old) => ({
        tasks: (old?.tasks ?? []).filter((t) => t.id !== id),
      }));
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['mints'], context.previous);
      dispatch({ type: 'SET_ERROR', message: 'Failed to delete task. It has been restored.' });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['mints'] });
      dispatch({ type: 'SET_DELETING_ID', id: null });
    },
  });

  const submitMint = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatch({ type: 'START_SAVING' });
    dispatch({ type: 'SET_FORM_ERROR', message: null });

    try {
      const mintUrl = form.mintUrl.trim();
      if (!mintUrl) {
        dispatch({ type: 'SET_FORM_ERROR', message: 'Paste a mint URL before creating a mint task.' });
        return;
      }

      if (!defaultWallet) {
        dispatch({ type: 'SET_FORM_ERROR', message: 'Set a default wallet before creating a mint task.' });
        return;
      }

      const payload = await createTaskMutation.mutateAsync({
        mintUrl: mintUrl,
        quantity: 1,
        wlMode: form.wlMode,
        ...(form.scheduleTime ? { scheduleTime: new Date(form.scheduleTime).toISOString() } : {}),
      });
      dispatch({ type: 'RESET_FORM' });
      if (payload.mintStatus === 'upcoming') {
        const phaseLabel = payload.wlPhase ? `${payload.wlPhase.toUpperCase()} phase` : 'Public phase';
        const schedMsg = payload.scheduledTime
          ? `${phaseLabel} scheduled — minting at ${new Date(payload.scheduledTime).toLocaleString()}.`
          : `${phaseLabel} queued for monitoring — will execute when the mint goes live.`;
        dispatch({ type: 'SET_SUCCESS', message: schedMsg });
      } else if (payload.mintStatus === 'monitoring') {
        const monitorMsg = payload.scheduledTime
          ? `🔍 Holder/WL phase live — public phase scheduled at ${new Date(payload.scheduledTime).toLocaleString()}. Auto-minting when live.`
          : '🔍 A holder / WL phase is currently live. Monitoring for public phase start — will auto-mint when public opens.';
        dispatch({ type: 'SET_SUCCESS', message: monitorMsg });
      } else if (payload.autoTriggered) {
        const phaseLabel = payload.wlPhase ? `${payload.wlPhase.toUpperCase()} phase` : 'Public mint';
        dispatch({ type: 'SET_SUCCESS', message: `⚡ ${phaseLabel} is live — auto-executing now. Check status below.` });
      } else {
        dispatch({ type: 'SET_SUCCESS', message: 'Live mint — task is ready for immediate execution.' });
      }
    } catch (requestError) {
      dispatch({
        type: 'SET_FORM_ERROR',
        message: requestError instanceof Error ? requestError.message : 'Failed to create mint task.',
      });
    } finally {
      dispatch({ type: 'STOP_SAVING' });
    }
  };

  const startTask = async (task: MintTask) => {
    dispatch({ type: 'SET_UPDATING_ID', id: task.id });
    dispatch({ type: 'SET_ERROR', message: null });

    try {
      const payload = await startTaskMutation.mutateAsync({ id: task.id, action: 'start' });
      if (payload.result && !payload.result.success) {
        dispatch({ type: 'SET_ERROR', message: payload.result.error ?? 'Mint execution failed.' });
      }
    } catch (requestError) {
      dispatch({ type: 'SET_ERROR', message: requestError instanceof Error ? requestError.message : 'Failed to start task.' });
    } finally {
      dispatch({ type: 'SET_UPDATING_ID', id: null });
    }
  };

  const cancelTask = async (task: MintTask) => {
    dispatch({ type: 'SET_UPDATING_ID', id: task.id });
    dispatch({ type: 'SET_ERROR', message: null });

    try {
      await cancelTaskMutation.mutateAsync({ id: task.id, action: 'cancel' });
    } catch (requestError) {
      dispatch({ type: 'SET_ERROR', message: requestError instanceof Error ? requestError.message : 'Failed to cancel task.' });
    } finally {
      dispatch({ type: 'SET_UPDATING_ID', id: null });
    }
  };

  const deleteTask = async (task: MintTask) => {
    dispatch({ type: 'SET_DELETING_ID', id: task.id });
    dispatch({ type: 'SET_ERROR', message: null });

    try {
      await deleteTaskMutation.mutateAsync(task.id);
    } catch (requestError) {
      dispatch({ type: 'SET_ERROR', message: requestError instanceof Error ? requestError.message : 'Failed to delete task.' });
    } finally {
      dispatch({ type: 'SET_DELETING_ID', id: null });
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Execution"
        title="Mints"
        description="Paste a mint URL to create a task with your default wallet and quantity 1."
        actions={
          defaultWallet ? (
            <Badge variant="info">Default: {defaultWallet.nickname || shortAddress(defaultWallet.address)}</Badge>
          ) : null
        }
      />

      <Card className="mb-6 p-4" tone="elevated">
        <form onSubmit={submitMint} className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <Input
            label="Mint URL"
            value={form.mintUrl}
            onChange={(event) => {
              dispatch({ type: 'PATCH_FORM', patch: { mintUrl: event.target.value } });
              dispatch({ type: 'SET_FORM_ERROR', message: null });
            }}
            placeholder="Paste mint page URL"
            required
          />
          <Button type="submit" loading={saving} disabled={!form.mintUrl.trim() || !defaultWallet}>
            <LinkIcon className="h-4 w-4" aria-hidden="true" />
            Mint
          </Button>
        </form>
        {/* WL / Allowlist checkbox */}
        <label className="mt-3 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={form.wlMode}
            onChange={(e) => dispatch({ type: 'PATCH_FORM', patch: { wlMode: e.target.checked } })}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-border accent-accent"
          />
          <span className="text-sm text-text">
            I have a <span className="font-medium text-accent">WL / Allowlist / Free-mint</span> allocation
            <span className="ml-1 text-xs text-muted">(skips public mint — checks your eligibility &amp; proof)</span>
          </span>
        </label>



        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
          <span>Wallet: {defaultWallet ? `${defaultWallet.nickname || shortAddress(defaultWallet.address)} / ${defaultWallet.chain}` : 'Set a default wallet first'}</span>
          <span>Quantity: 1</span>
          <span>{form.wlMode ? 'WL mode: will check eligibility and skip public mint.' : 'Live mints execute instantly; upcoming mints are scheduled automatically.'}</span>
        </div>
        {formError ? <div className="mt-3 rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">{formError}</div> : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Executing" value={String(runningCount)} detail="Currently running" icon={Zap} tone="primary" />
        <MetricCard label="Queued" value={String(queuedCount)} detail="Pending or about to run" icon={CalendarClock} tone="accent" />
        <MetricCard label="Failed" value={String(retryCount)} detail="Need attention — tap ↻ to retry" icon={RotateCcw} tone="warning" />
      </div>

      {success ? (
        <div className="mt-6 rounded-lg border border-green-500/20 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400" role="status">
          {success}
        </div>
      ) : null}

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
          {isLoading ? (
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
                <div key={task.id} className="grid grid-cols-12 gap-4 px-5 py-4 items-center cursor-pointer hover:bg-white/[0.02] transition-colors" onClick={() => setConsoleTaskId(task.id)}>
                  <div className="col-span-5 min-w-0">
                    <p className="truncate font-medium text-text">{title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {collection?.chain ?? wallet?.chain ?? 'unknown'} / fee {task.mintPrice ?? 'unset'}
                      {task.phase ? (
                        <span className="ml-2 inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-medium capitalize text-accent">
                          {task.phase}
                        </span>
                      ) : null}
                    </p>
                    {/* countdown or monitoring indicator */}
                    {task.scheduledTime ? (
                      task.status === 'pending' || task.status === 'monitoring' ? (
                        // CountdownTimer returns null when time is past + monitoring → show fallback
                        <>
                          <p className="mt-1 text-xs text-accent">
                            <span>⏱ Mints in: <CountdownTimer targetTime={task.scheduledTime} monitoringStatus={task.status === 'monitoring'} /></span>
                          </p>
                          {task.status === 'monitoring' ? (
                            <p className="mt-1 text-xs text-muted">🔍 Monitoring for public phase start…</p>
                          ) : null}
                        </>
                      ) : (
                        <p className="mt-1 text-xs text-accent">
                          <ScheduleLabel status={task.status} scheduledTime={task.scheduledTime!} />
                        </p>
                      )
                    ) : task.status === 'monitoring' ? (
                      <p className="mt-1 text-xs text-muted">🔍 Monitoring for public phase start…</p>
                    ) : null}
                    {/* Show the REAL execution failure reason (from task logs)
                        first; fall back to risk notes only if no error log exists. */}
                    {task.status === 'failed' && task.failureReason ? (
                      <p className="mt-1 text-xs text-danger truncate" title={task.failureReason}>
                        Reason: {task.failureReason}
                      </p>
                    ) : task.status === 'failed' && task.riskReasons && task.riskReasons.length > 0 ? (
                      <p className="mt-1 text-xs text-danger truncate" title={task.riskReasons.join('; ')}>
                        Reason: {task.riskReasons[0]}
                      </p>
                    ) : task.status === 'failed' ? (
                      <p className="mt-1 text-xs text-danger">Execution failed — click retry to try again</p>
                    ) : null}
                  </div>
                  <div className="col-span-2 hidden md:block">
                    <Badge variant={statusVariant(task.status) as 'success' | 'warning' | 'danger' | 'info'}>{task.status}</Badge>
                  </div>
                  <div className="col-span-2 hidden min-w-0 lg:block">
                    <p className="truncate font-mono text-sm text-muted">{wallet ? shortAddress(wallet.address) : 'Unassigned'}</p>
                    {wallet ? <Badge variant="info">{wallet.walletType}</Badge> : null}
                  </div>
                  <p className="col-span-2 hidden font-mono text-sm text-text sm:block">{task.quantity}</p>
                  <div className="col-span-7 flex justify-end gap-1 sm:col-span-1">
                    {/* Hide play/retry when QStash is already handling execution */}
                    {task.qstashMessageId && (task.status === 'ready' || task.status === 'monitoring') ? (
                      <span className="flex h-8 w-8 items-center justify-center text-accent" title="Auto-executing via QStash" onClick={(e) => e.stopPropagation()}>
                        <Zap className="h-4 w-4 animate-pulse" aria-hidden="true" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startTask(task); }}
                        disabled={updatingId === task.id || task.status === 'running' || task.status === 'completed'}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-50 ${
                          task.status === 'failed'
                            ? 'text-warning hover:bg-warning/10'
                            : 'text-muted hover:bg-white/5 hover:text-text'
                        }`}
                        aria-label={`${task.status === 'failed' || task.status === 'cancelled' ? 'Retry' : 'Start'} ${title}`}
                        title={task.status === 'failed' ? 'Retry' : task.status === 'cancelled' ? 'Restart' : 'Start'}
                      >
                        {task.status === 'failed' ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    )}
                    <button type="button" onClick={(e) => { e.stopPropagation(); cancelTask(task); }} disabled={updatingId === task.id || task.status === 'completed' || task.status === 'cancelled'} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-warning disabled:opacity-50" aria-label={`Cancel ${title}`}>
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); deleteTask(task); }} disabled={deletingId === task.id} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-danger disabled:opacity-50" aria-label={`Delete ${title}`}>
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
                description="Paste a mint URL above to create a task with your default wallet."
                action={
                  <Button type="button" onClick={() => {
                    const input = document.querySelector<HTMLInputElement>('input[placeholder="Paste mint page URL"]');
                    input?.focus();
                  }}>
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
          <Button type="button" variant="secondary" onClick={() => dispatch({ type: 'OPEN_QUEUE' })}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            Queue Settings
          </Button>
        </div>
      </Card>

      {consoleTaskId ? (
        <TaskConsole
          open={!!consoleTaskId}
          onClose={() => setConsoleTaskId(null)}
          taskId={consoleTaskId}
          taskStatus={tasks.find(t => t.id === consoleTaskId)?.status ?? 'unknown'}
          contractAddress={tasks.find(t => t.id === consoleTaskId)?.contractAddress ?? null}
          phase={tasks.find(t => t.id === consoleTaskId)?.phase ?? null}
        />
      ) : null}

      <Modal open={queueOpen} title="Queue Settings" onClose={() => dispatch({ type: 'CLOSE_QUEUE' })}>
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">Queue controls are currently read from mint task status in the database. Create, start, and delete actions are available on each task.</p>
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => dispatch({ type: 'CLOSE_QUEUE' })}>Close</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
