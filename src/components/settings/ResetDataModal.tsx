'use client';

import { useState } from 'react';
import { AlertTriangle, Check, RefreshCw, Trash2 } from 'lucide-react';

interface ResetResult {
  ok: boolean;
  total: number;
  results: Record<string, number>;
  message: string;
}

const TABLES = [
  { key: 'mintHistory',    label: 'Mint History',        desc: 'Blockchain transaction receipts' },
  { key: 'analyzerHistory',label: 'Analyzer History',    desc: 'Contract analysis records' },
];

const KEPT = [
  'Your account & login',
  'Connected wallets (encrypted keys)',
  'Mint queue (pending & completed tasks)',
  'Collections watchlist',
  'Whale tracker wallets',
  'Settings & notification preferences',
  'Integrations configuration',
];

export function ResetDataModal({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<'confirm' | 'typing' | 'running' | 'done' | 'error'>('confirm');
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<ResetResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const CONFIRM_PHRASE = 'reset my data';
  const canReset = typed.toLowerCase() === CONFIRM_PHRASE;

  async function handleReset() {
    setPhase('running');
    try {
      const res = await fetch('/api/user/reset-data', { method: 'POST' });
      const data = await res.json() as ResetResult & { error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Reset failed');
      setResult(data);
      setPhase('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Reset failed');
      setPhase('error');
    }
  }

  if (phase === 'done' && result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="relative z-10 w-full max-w-md rounded-2xl border border-success/30 bg-elevated overflow-hidden"
          style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.70), 0 0 40px rgba(16,185,129,0.08)' }}
        >
          <div className="h-px bg-gradient-to-r from-transparent via-success/60 to-transparent" />
          <div className="p-6 space-y-5 text-center">
            <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl border border-success/25 bg-success/10">
              <Check className="h-7 w-7 text-success" />
            </div>
            <div>
              <p className="text-lg font-black text-text">History cleared</p>
              <p className="mt-1 text-sm text-muted">{result.message}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4 text-left space-y-1.5">
              {TABLES.map(t => (
                <div key={t.key} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{t.label}</span>
                  <span className="font-mono font-bold text-success">{result.results[t.key] ?? 0} deleted</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { onClose(); window.location.reload(); }}
              className="w-full rounded-xl border border-neon/30 bg-neon/10 py-2.5 text-sm font-bold text-neon hover:bg-neon/20 transition-all"
            >
              Done — Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={phase === 'confirm' ? onClose : undefined} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-danger/30 bg-elevated overflow-hidden"
        style={{ boxShadow: '0 24px 80px rgba(0,0,0,0.70), 0 0 40px rgba(239,68,68,0.06)' }}
      >
        <div className="h-px bg-gradient-to-r from-transparent via-danger/60 to-transparent" />

        {/* Header */}
        <div className="p-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-danger/30 bg-danger/10">
              <Trash2 className="h-5 w-5 text-danger" />
            </div>
            <div>
              <p className="text-base font-black text-text">Reset All Data</p>
              <p className="text-xs text-muted">This action is permanent and cannot be undone</p>
            </div>
          </div>

          {/* What gets deleted */}
          <div className="rounded-xl border border-danger/20 bg-danger/5 p-4 mb-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-danger mb-2.5">Will be deleted</p>
            <div className="space-y-1.5">
              {TABLES.map(t => (
                <div key={t.key} className="flex items-start gap-2">
                  <div className="mt-0.5 h-1.5 w-1.5 rounded-full bg-danger/60 shrink-0" />
                  <div>
                    <span className="text-xs font-semibold text-danger/90">{t.label}</span>
                    <span className="text-xs text-muted"> — {t.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* What is kept */}
          <div className="rounded-xl border border-success/20 bg-success/5 p-4 mb-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-success mb-2.5">Will be kept</p>
            <div className="space-y-1.5">
              {KEPT.map(k => (
                <div key={k} className="flex items-center gap-2">
                  <Check className="h-3 w-3 text-success shrink-0" />
                  <span className="text-xs text-muted">{k}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Confirmation input */}
          {phase === 'error' ? (
            <div className="rounded-xl border border-danger/25 bg-danger/8 px-4 py-3 text-sm text-danger mb-4">
              <AlertTriangle className="h-4 w-4 inline mr-2" />{errorMsg}
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              <p className="text-xs text-muted">
                Type <span className="font-mono font-bold text-danger">reset my data</span> to confirm
              </p>
              <input
                type="text"
                value={typed}
                onChange={e => { setTyped(e.target.value); setPhase('typing'); }}
                placeholder="reset my data"
                autoFocus
                className="h-10 w-full rounded-lg border border-border bg-background/80 px-3 text-sm text-text placeholder:text-muted/40 focus:border-danger/50 focus:outline-none focus:ring-2 focus:ring-danger/15 transition-all font-mono"
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl border border-border bg-surface py-2.5 text-sm font-bold text-secondary hover:bg-surface-hover transition-all"
            >
              Cancel
            </button>
            <button
              onClick={() => { void handleReset(); }}
              disabled={!canReset || phase === 'running'}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-danger/30 bg-danger/10 py-2.5 text-sm font-bold text-danger hover:bg-danger/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              style={canReset ? { boxShadow: '0 0 20px rgba(239,68,68,0.20)' } : undefined}
            >
              {phase === 'running'
                ? <><RefreshCw className="h-4 w-4 animate-spin" /> Clearing…</>
                : <><Trash2 className="h-4 w-4" /> Clear History</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
