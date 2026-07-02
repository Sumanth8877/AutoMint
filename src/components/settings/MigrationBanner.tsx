'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

type State = 'checking' | 'pending' | 'applying' | 'done' | 'up-to-date' | 'error';

interface MigrationBannerProps {
  /** API route implementing GET (status check) + POST (apply). */
  endpoint?: string;
  /** Shown in the pending-state description, e.g. "analyzer_history" or "collections". */
  tableLabel?: string;
  /** What breaks if this isn't applied, e.g. "Analyzer History" or "Collections floor tracking". */
  affectedFeature?: string;
}

// Generalized from the original analyzer-only banner so any table needing a
// self-serve column migration (this repo uses drizzle-kit push, not versioned
// migration files, so schema changes need a one-time endpoint hit post-deploy)
// can reuse the same UI instead of a bespoke component per table.
export function MigrationBanner({
  endpoint = '/api/system/apply-analyzer-migration',
  tableLabel = 'analyzer_history',
  affectedFeature = 'Analyzer History',
}: MigrationBannerProps = {}) {
  const [state, setState] = useState<State>('checking');
  const [message, setMessage] = useState<string | null>(null);

  // On mount, ask the server whether the table is actually missing any
  // columns. This replaces the old behavior of always showing "pending"
  // regardless of real database state (which caused the banner to reappear
  // after every refresh, even once the migration had already been applied).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint, { method: 'GET' });
        const data = await res.json() as { pending: boolean; missing?: string[]; error?: string };
        if (cancelled) return;
        setState(data.pending ? 'pending' : 'up-to-date');
      } catch {
        if (cancelled) return;
        // If the status check itself fails, don't scare the user with a
        // false "pending" banner — just hide it silently.
        setState('up-to-date');
      }
    })();
    return () => { cancelled = true; };
  }, [endpoint]);

  async function applyMigration() {
    setState('applying');
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json() as { ok: boolean; message?: string; applied?: number; failed?: number };
      setMessage(data.message ?? (data.ok ? 'Migration applied.' : 'Migration failed.'));
      setState(data.ok ? 'done' : 'error');
    } catch {
      setMessage('Network error — could not apply migration.');
      setState('error');
    }
  }

  if (state === 'checking' || state === 'up-to-date') return null;

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
              : `The ${tableLabel} table is missing new columns. Run the migration to fix ${affectedFeature}.`}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => { void applyMigration(); }}
        disabled={state === 'applying'}
        className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-bold text-warning hover:bg-warning/20 disabled:opacity-50 transition-all"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${state === 'applying' ? 'animate-spin' : ''}`} />
        {state === 'applying' ? 'Applying…' : 'Apply Migration'}
      </button>
    </div>
  );
}
