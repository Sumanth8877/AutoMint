'use client';

import { useEffect, useMemo, useReducer } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
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
import type { WalletType } from '@/lib/wallets/detection';

type MintTask = {
  id: string;
  walletId: string | null;
  collectionId: string | null;
  quantity: number;
  status: string;
  contractAddress: string | null;
  mintPrice: string | null;
  scheduledTime: string | null;       // #8 — when upcoming mint will fire
  riskReasons: string[] | null;       // U3 — failure reasons from execution
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

type MintsForm = { walletId: string; mintUrl: string; scheduleTime: string };

type MintsState = {
  /** True while the create-mint POST is in-flight */
  saving: boolean;
  /** True while the analyze POST is in-flight */
  analyzing: boolean;
  /** ID of the task currently being started/cancelled, or null */
  updatingId: string | null;
  /** ID of the task currently being deleted, or null */
  deletingId: string | null;
  /** Whether the New Mint modal is open */
  modalOpen: boolean;
  /** Whether the Queue Settings modal is open */
  queueOpen: boolean;
  /** Top-level error banner (fetch/mutation failures) */
  error: string | null;
  /** Inline form error shown inside the modal */
  formError: string | null;
  /** Controlled form values */
  form: MintsForm;
  /** The URL that was last successfully analyzed (used to guard submitMint) */
  analyzedUrl: string | null;
};

type MintsAction =
  | { type: 'START_SAVING' }
  | { type: 'STOP_SAVING' }
  | { type: 'START_ANALYZING' }
  | { type: 'STOP_ANALYZING' }
  | { type: 'SET_UPDATING_ID'; id: string | null }
  | { type: 'SET_DELETING_ID'; id: string | null }
  | { type: 'OPEN_MODAL' }
  | { type: 'CLOSE_MODAL' }
  | { type: 'OPEN_QUEUE' }
  | { type: 'CLOSE_QUEUE' }
  | { type: 'SET_ERROR'; message: string | null }
  | { type: 'SET_FORM_ERROR'; message: string | null }
  | { type: 'PATCH_FORM'; patch: Partial<MintsForm> }
  | { type: 'SET_ANALYZED_URL'; url: string | null }
  | { type: 'RESET_FORM' };

const initialState: MintsState = {
  saving: false,
  analyzing: false,
  updatingId: null,
  deletingId: null,
  modalOpen: false,
  queueOpen: false,
  error: null,
  formError: null,
  form: { walletId: '', mintUrl: '', scheduleTime: '' },
  analyzedUrl: null,
};

function mintsReducer(state: MintsState, action: MintsAction): MintsState {
  switch (action.type) {
    case 'START_SAVING':    return { ...state, saving: true };
    case 'STOP_SAVING':     return { ...state, saving: false };
    case 'START_ANALYZING': return { ...state, analyzing: true };
    case 'STOP_ANALYZING':  return { ...state, analyzing: false };
    case 'SET_UPDATING_ID': return { ...state, updatingId: action.id };
    case 'SET_DELETING_ID': return { ...state, deletingId: action.id };
    case 'OPEN_MODAL':      return { ...state, modalOpen: true };
    case 'CLOSE_MODAL':     return {
      ...state,
      modalOpen: false,
      saving: false,
      analyzing: false,
      formError: null,
      form: initialState.form,
      analyzedUrl: null,
    };
    case 'OPEN_QUEUE':      return { ...state, queueOpen: true };
    case 'CLOSE_QUEUE':     return { ...state, queueOpen: false };
    case 'SET_ERROR':       return { ...state, error: action.message };
    case 'SET_FORM_ERROR':  return { ...state, formError: action.message };
    case 'PATCH_FORM':      return { ...state, form: { ...state.form, ...action.patch } };
    case 'SET_ANALYZED_URL': return { ...state, analyzedUrl: action.url };
    case 'RESET_FORM':      return {
      ...state,
      form: initialState.form,
      formError: null,
      analyzedUrl: null,
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

export default function MintsClient() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [state, dispatch] = useReducer(mintsReducer, initialState);
  const { saving, analyzing, updatingId, deletingId, modalOpen, queueOpen, error, formError, form, analyzedUrl } = state;

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
  const evmWallets = useMemo(() => wallets.filter((wallet) => wallet.walletType === 'EVM'), [wallets]);
  const defaultWallet = useMemo(() => wallets.find((wallet) => wallet.isDefault), [wallets]);
  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const queuedCount = tasks.filter((task) => task.status === 'pending' || task.status === 'monitoring').length;
  const readyCount = tasks.filter((task) => task.status === 'ready').length;
  const retryCount = tasks.filter((task) => task.status === 'failed').length;

  // Handle mintUrl from URL params and set default wallet
  useEffect(() => {
    const mintUrlParam = searchParams.get('mintUrl');
    if (mintUrlParam) {
      dispatch({ type: 'PATCH_FORM', patch: { mintUrl: mintUrlParam, walletId: defaultWallet?.id ?? '' } });
      dispatch({ type: 'OPEN_MODAL' });
    }
  }, [searchParams, defaultWallet?.id]);

  // Set default wallet when modal opens
  useEffect(() => {
    if (modalOpen && defaultWallet && !form.walletId) {
      dispatch({ type: 'PATCH_FORM', patch: { walletId: defaultWallet.id } });
    }
  }, [modalOpen, defaultWallet, form.walletId]);

  // Mirror React Query fetch failures into the error banner
  useEffect(() => {
    if (fetchError) {
      dispatch({
        type: 'SET_ERROR',
        message: fetchError instanceof Error ? fetchError.message : 'Failed to load mint data.',
      });
    }
  }, [fetchError]);

  // Create task mutation
  const createTaskMutation = useMutation({
    mutationFn: async (data: { walletId: string; mintUrl: string; analysisConfirmed: boolean; quantity: string; scheduleTime?: string }) => {
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

  const handleMintUrlChange = (value: string) => {
    dispatch({ type: 'PATCH_FORM', patch: { mintUrl: value } });
    // Clear analyzed state if the URL has changed
    if (analyzedUrl !== value.trim()) {
      dispatch({ type: 'SET_ANALYZED_URL', url: null });
    }
  };

  const analyzeMintUrl = async () => {
    const mintUrl = form.mintUrl.trim();
    if (!mintUrl) {
      dispatch({ type: 'SET_FORM_ERROR', message: 'Paste a mint URL before running analysis.' });
      return;
    }

    dispatch({ type: 'START_ANALYZING' });
    dispatch({ type: 'SET_FORM_ERROR', message: null });

    try {
      await apiRequest('/api/analyzer', {
        method: 'POST',
        body: { input: mintUrl },
      });
      dispatch({ type: 'SET_ANALYZED_URL', url: mintUrl });
    } catch (requestError) {
      dispatch({
        type: 'SET_FORM_ERROR',
        message: requestError instanceof Error ? requestError.message : 'Failed to analyze mint URL.',
      });
    } finally {
      dispatch({ type: 'STOP_ANALYZING' });
    }
  };

  const submitMint = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatch({ type: 'START_SAVING' });
    dispatch({ type: 'SET_FORM_ERROR', message: null });

    try {
      const mintUrl = form.mintUrl.trim();
      if (!analyzedUrl || analyzedUrl !== mintUrl) {
        dispatch({ type: 'SET_FORM_ERROR', message: 'Please analyze the URL before creating a mint task' });
        return;
      }

      const payload = await createTaskMutation.mutateAsync({
        walletId: form.walletId,
        mintUrl: mintUrl,
        analysisConfirmed: true,
        quantity: '1',
        scheduleTime: form.scheduleTime || undefined,
      });
      dispatch({ type: 'CLOSE_MODAL' });
      if (payload.analyzerRequired) {
        dispatch({ type: 'SET_ERROR', message: 'Mint task created from URL. Run analysis before scheduling this mint.' });
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
        description="Plan, monitor, pause, and retry mint execution tasks with clear risk state and wallet assignment."
        actions={
          <Button type="button" onClick={() => dispatch({ type: 'OPEN_MODAL' })}>
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
                <div key={task.id} className="grid grid-cols-12 gap-4 px-5 py-4">
                  <div className="col-span-5 min-w-0">
                    <p className="truncate font-medium text-text">{title}</p>
                    <p className="mt-1 text-xs text-muted">{collection?.chain ?? wallet?.chain ?? 'unknown'} / fee {task.mintPrice ?? 'unset'}</p>
                    {/* #8 — show scheduled time for upcoming mints */}
                    {task.scheduledTime && (task.status === 'pending' || task.status === 'monitoring') ? (
                      <p className="mt-1 text-xs text-accent">
                        Scheduled: {new Date(task.scheduledTime).toLocaleString()}
                      </p>
                    ) : null}
                    {/* U3 — show error reason for failed tasks */}
                    {task.status === 'failed' && task.riskReasons && task.riskReasons.length > 0 ? (
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
                    <button
                      type="button"
                      onClick={() => startTask(task)}
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
                  <Button type="button" onClick={() => dispatch({ type: 'OPEN_MODAL' })}>
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

      <Modal open={modalOpen} title="New Mint" onClose={() => dispatch({ type: 'CLOSE_MODAL' })}>
        <form onSubmit={submitMint} className="space-y-4">
          <label className="block text-sm font-medium text-muted">
            Wallet
            <select
              value={form.walletId}
              onChange={(event) => dispatch({ type: 'PATCH_FORM', patch: { walletId: event.target.value } })}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              required
            >
              <option value="">Select wallet</option>
              {evmWallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>{wallet.nickname || shortAddress(wallet.address)} / {wallet.walletType} / {wallet.chain}</option>
              ))}
            </select>
          </label>
          <div className="space-y-2">
            <Input
              label="Mint URL"
              value={form.mintUrl}
              onChange={(event) => handleMintUrlChange(event.target.value)}
              placeholder="https://..."
              required
            />
            <div className="flex items-center justify-between gap-3">
              {analyzedUrl === form.mintUrl.trim() && form.mintUrl.trim() ? (
                <span className="text-xs text-success">Analysis ready</span>
              ) : (
                <span className="text-xs text-muted">Paste a URL to analyze</span>
              )}
              <Button type="button" variant="secondary" onClick={analyzeMintUrl} loading={analyzing} disabled={!form.mintUrl.trim()}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Analyze
              </Button>
            </div>
            {analyzedUrl === form.mintUrl.trim() && form.mintUrl.trim() && (
              <div className="flex items-center gap-2 rounded-lg bg-background/50 p-3">
                <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" />
                <span className="text-sm font-medium text-success">Safe to mint</span>
              </div>
            )}
          </div>
          {/* #9 — optional manual schedule override (auto-detected if blank) */}
          <label className="block text-sm font-medium text-muted">
            Schedule Time (optional)
            <input
              type="datetime-local"
              value={form.scheduleTime}
              onChange={(event) => dispatch({ type: 'PATCH_FORM', patch: { scheduleTime: event.target.value } })}
              className="mt-2 h-11 w-full rounded-lg border border-border bg-background/70 px-4 text-sm text-text outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <p className="mt-1 text-xs text-muted">Leave blank to auto-detect from the mint page.</p>
          </label>
          {formError ? <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger" role="alert">{formError}</div> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dispatch({ type: 'CLOSE_MODAL' })}>Cancel</Button>
            <Button type="submit" loading={saving} disabled={!analyzedUrl || analyzedUrl !== form.mintUrl.trim()}>
              Create Mint
            </Button>
          </div>
        </form>
      </Modal>

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
