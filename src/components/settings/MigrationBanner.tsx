'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

export function MigrationBanner() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function applyMigration() {
    setState('running');
    try {
      const res = await fetch('/api/system/apply-analyzer-migration', { method: 'POST' });
      const data = await res.json() as { ok: boolean; message?: string; applied?: number; failed?: number };
      setMessage(data.message ?? (data.ok ? 'Migration applied.' : 'Migration failed.'));
      setState(data.ok ? 'done' : 'error');
    } catch {
      setMessage('Network error — could not apply migration.');
      setState('error');
    }
  }

  if (state === 'done') return (
    <div className="flex items-center gap-3 rounded-xl border border-success/25 bg-success/8 px-4 py-3 text-sm text-success">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );

  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-warning/25 bg-warning/8 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
        <div>
          <p className="text-sm font-bold text-warning">Database migration pending</p>
          <p className="text-xs text-muted mt-0.5">
            {state === 'error'
              ? message
              : 'The analyzer_history table is missing new columns. Run the migration to fix Analyzer History.'}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => { void applyMigration(); }}
        disabled={state === 'running'}
        className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-bold text-warning hover:bg-warning/20 disabled:opacity-50 transition-all"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${state === 'running' ? 'animate-spin' : ''}`} />
        {state === 'running' ? 'Applying…' : 'Apply Migration'}
      </button>
    </div>
  );
}
