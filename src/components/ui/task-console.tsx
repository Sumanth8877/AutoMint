'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal, X } from 'lucide-react';
import { apiRequest } from '@/lib/api/client';

type LogEntry = { id: string; message: string; level: 'info' | 'warn' | 'error' | 'success'; createdAt: string; };

const levelStyles: Record<string, string> = {
  info:    'text-secondary',
  warn:    'text-warning',
  error:   'text-danger',
  success: 'text-success',
};
const levelPrefix: Record<string, string> = {
  info: 'ℹ', warn: '⚠', error: '✖', success: '✔',
};

export function TaskConsole({ taskId, onClose }: { taskId: string; onClose?: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchLogs() {
      try {
        const data = await apiRequest<LogEntry[]>(`/api/mints/${taskId}/logs`);
        if (!cancelled) { setLogs(data); setLoading(false); }
      } catch { if (!cancelled) setLoading(false); }
    }
    fetchLogs();
    const interval = setInterval(fetchLogs, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [taskId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  return (
    <div className="rounded-xl border border-border bg-[#020408] overflow-hidden">
      {/* Console header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-surface">
        <div className="flex items-center gap-2">
          <Terminal className="h-3.5 w-3.5 text-neon" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-neon">Execution Log</span>
          <span className="text-[10px] font-mono text-muted">#{taskId.slice(-8)}</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <div className="h-3 w-3 rounded-full border border-neon/40 border-t-neon animate-spin" />}
          {onClose && (
            <button onClick={onClose} className="flex h-5 w-5 items-center justify-center rounded text-muted hover:text-text transition-colors">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Log output */}
      <div className="h-48 overflow-y-auto p-4 font-mono text-xs space-y-0.5">
        {logs.length === 0 && !loading && (
          <p className="text-muted">No logs yet...</p>
        )}
        {logs.map(log => (
          <div key={log.id} className="flex gap-2">
            <span className="text-muted/50 shrink-0 tabular-nums">
              {new Date(log.createdAt).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className={`shrink-0 ${levelStyles[log.level]}`}>{levelPrefix[log.level]}</span>
            <span className={levelStyles[log.level]}>{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
