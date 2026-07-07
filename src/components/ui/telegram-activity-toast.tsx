'use client';

import { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Terminal, X } from 'lucide-react';

// ── Human-readable tool labels ──────────────────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  get_wallets:                  'Reading wallets…',
  get_wallet_balance:           'Checking wallet balance…',
  watch_wallet:                 'Adding wallet to whale tracker…',
  get_watched_wallets:          'Fetching watched wallets…',
  remove_watched_wallet:        'Removing watched wallet…',
  get_whale_activity:           'Loading whale activity…',
  create_copy_mint_rule:        'Creating copy-mint rule…',
  get_copy_mint_rules:          'Fetching copy-mint rules…',
  delete_copy_mint_rule:        'Deleting copy-mint rule…',
  mint_from_url:                'Queuing mint task…',
  get_active_mints:             'Loading active mints…',
  cancel_mint:                  'Cancelling mint…',
  retry_failed_mint:            'Retrying failed mint…',
  diagnose_mint_failure:        'Diagnosing mint failure…',
  analyze_contract:             'Running contract analysis…',
  get_analytics:                'Loading analytics…',
  get_mint_history:             'Fetching mint history…',
  get_mint_logs:                'Reading mint logs…',
  get_collections:              'Loading collections…',
  discover_collection:          'Discovering collection…',
  get_execution_settings:       'Reading execution settings…',
  update_execution_settings:    'Updating execution settings…',
  get_notification_settings:    'Reading notification settings…',
  update_notification_settings: 'Updating notification settings…',
  get_system_status:            'Checking system status…',
  search_data:                  'Searching data…',
  get_activities:               'Loading activities…',
  get_analyzer_history:         'Fetching analyzer history…',
  get_monitoring_websites:      'Loading monitored websites…',
  add_monitoring_website:       'Adding monitoring website…',
  remove_monitoring_website:    'Removing monitoring website…',
  get_monitoring_events:        'Loading monitoring events…',
  get_gas_estimate:             'Estimating gas…',
  check_mint_status_onchain:    'Checking on-chain mint status…',
  refresh_collection_floor:     'Refreshing collection floor…',
  remove_collection:            'Removing collection…',
  update_wallet:                'Updating wallet…',
  remove_wallet:                'Removing wallet…',
  set_default_wallet:           'Setting default wallet…',
  refresh_wallet_balance:       'Refreshing wallet balance…',
  get_email_settings:           'Reading email settings…',
  update_email_settings:        'Updating email settings…',
  get_integrations_status:      'Checking integrations…',
  get_usage:                    'Loading usage stats…',
  reset_all_data:               'Resetting all data…',
};

export interface TelegramCommandEvent {
  type: 'ai:command' | 'ai:command:done';
  ts: number;
  meta?: {
    message?: string;
    tool?: string;
    reply?: string;
    source?: string;
  };
}

interface ToastState {
  id: string;
  phase: 'running' | 'done';
  message: string;        // original user command
  currentTool?: string;   // tool currently running
  reply?: string;         // final AI reply
  startedAt: number;
}

interface Props {
  /** Called by useEventStream when an ai:command or ai:command:done event arrives */
  event: TelegramCommandEvent | null;
}

const DISMISS_AFTER_MS = 8000;  // auto-dismiss "done" toast after 8s

export function TelegramActivityToast({ event }: Props) {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const activeId = useRef<string | null>(null);
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!event) return;
    const { type, ts, meta } = event;

    if (type === 'ai:command') {
      if (meta?.tool) {
        // Tool-level event: update the running toast's current tool
        setToasts(prev =>
          prev.map(t =>
            t.id === activeId.current
              ? { ...t, currentTool: meta.tool }
              : t,
          ),
        );
      } else if (meta?.message) {
        // New command started: create a toast
        const id = `tg-${ts}`;
        activeId.current = id;
        setToasts(prev => [
          ...prev.filter(t => t.phase !== 'done'), // keep max 1 running + done
          {
            id,
            phase: 'running',
            message: meta.message!,
            startedAt: ts,
          },
        ]);
      }
    }

    if (type === 'ai:command:done') {
      const id = activeId.current;
      if (!id) return;
      setToasts(prev =>
        prev.map(t =>
          t.id === id
            ? { ...t, phase: 'done', reply: meta?.reply, currentTool: undefined }
            : t,
        ),
      );
      // Auto-dismiss after DISMISS_AFTER_MS
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
        dismissTimers.current.delete(id);
        if (activeId.current === id) activeId.current = null;
      }, DISMISS_AFTER_MS);
      dismissTimers.current.set(id, timer);
    }
  }, [event]);

  function dismiss(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = dismissTimers.current.get(id);
    if (timer) { clearTimeout(timer); dismissTimers.current.delete(id); }
    if (activeId.current === id) activeId.current = null;
  }

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Telegram AI activity"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full"
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`
            flex items-start gap-3 rounded-xl border shadow-lg px-4 py-3 text-sm
            transition-all duration-300
            ${toast.phase === 'running'
              ? 'bg-surface border-primary/30 text-text'
              : 'bg-surface border-success/30 text-text'}
          `}
          role="status"
        >
          {/* Icon */}
          <div className="mt-0.5 shrink-0">
            {toast.phase === 'running' ? (
              <Bot className="h-5 w-5 text-primary animate-pulse" />
            ) : (
              <CheckCircle2 className="h-5 w-5 text-success" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                Telegram AI
              </span>
            </div>

            {/* Command message */}
            <p className="font-medium text-text truncate" title={toast.message}>
              {toast.message.length > 60
                ? `${toast.message.slice(0, 60)}…`
                : toast.message}
            </p>

            {/* Running: show current tool */}
            {toast.phase === 'running' && toast.currentTool && (
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                <span className="truncate">
                  {TOOL_LABELS[toast.currentTool] ?? `Running ${toast.currentTool}…`}
                </span>
              </div>
            )}

            {toast.phase === 'running' && !toast.currentTool && (
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted">
                <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                <span>Thinking…</span>
              </div>
            )}

            {/* Done: show reply preview */}
            {toast.phase === 'done' && toast.reply && (
              <div className="flex items-center gap-1.5 mt-1 text-xs text-success">
                <Terminal className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {toast.reply.length > 80
                    ? `${toast.reply.slice(0, 80)}…`
                    : toast.reply}
                </span>
              </div>
            )}

            {toast.phase === 'done' && !toast.reply && (
              <p className="mt-1 text-xs text-success">Done ✓</p>
            )}
          </div>

          {/* Dismiss */}
          <button
            onClick={() => dismiss(toast.id)}
            className="mt-0.5 shrink-0 text-muted hover:text-text transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
