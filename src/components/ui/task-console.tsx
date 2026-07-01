'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/ui/modal';
import Badge from '@/components/ui/Badge';
import { apiRequest } from '@/lib/api/client';
import { Terminal, ExternalLink } from 'lucide-react';

// H-2 fix — per-chain block explorer resolution
type Chain = 'ethereum' | 'base' | 'polygon' | 'arbitrum';
const EXPLORER_HOSTS: Record<Chain, string> = {
  ethereum: 'https://etherscan.io/address/',
  base: 'https://basescan.org/address/',
  polygon: 'https://polygonscan.com/address/',
  arbitrum: 'https://arbiscan.io/address/',
};
function resolveExplorer(chain: string | null | undefined, address: string): string {
  const c = (chain ?? 'ethereum').toLowerCase();
  const host = EXPLORER_HOSTS[c as Chain] ?? EXPLORER_HOSTS.ethereum;
  return `${host}${address}`;
}


type LogEntry = {
  id: string;
  event: string;
  status: 'info' | 'success' | 'warning' | 'error';
  message: string | null;
  createdAt: string;
};

type TaskConsoleProps = {
  open: boolean;
  onClose: () => void;
  taskId: string;
  taskStatus: string;
  contractAddress: string | null;
  chain?: string | null;
  phase: string | null;
  /** Chain determines which block explorer URL to use for the contract link. */
  chain?: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  info: 'text-blue-400',
  success: 'text-green-400',
  warning: 'text-yellow-400',
  error: 'text-red-400',
};

const STATUS_ICONS: Record<string, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✗',
};

// H-2 fix: chain-specific block explorers. Previously hardcoded to etherscan.io
// which returned 404 for Base, Polygon, and Arbitrum contract addresses.
const EXPLORER_HOSTS: Record<string, string> = {
  ethereum: 'https://etherscan.io/address/',
  base:     'https://basescan.org/address/',
  polygon:  'https://polygonscan.com/address/',
  arbitrum: 'https://arbiscan.io/address/',
};

function explorerUrl(chain: string | null | undefined, contractAddress: string): string {
  const base = EXPLORER_HOSTS[chain?.toLowerCase() ?? ''] ?? EXPLORER_HOSTS.ethereum;
  return `${base}${contractAddress}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function TaskConsole({ open, onClose, taskId, taskStatus, contractAddress, phase, chain }: TaskConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isActive = ['pending', 'monitoring', 'ready', 'running', 'unconfirmed'].includes(taskStatus);

  const { data } = useQuery({
    queryKey: ['task-logs', taskId],
    queryFn: () => apiRequest<{ logs: LogEntry[] }>(`/api/mints/${taskId}/logs`),
    enabled: open,
    refetchInterval: isActive ? 2000 : false,
  });

  const logs = data?.logs ?? [];

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <Modal open={open} title="" onClose={onClose}>
      <div className="-m-6">
        {/* Header bar */}
        <div className="flex items-center gap-3 border-b border-border bg-gray-900 px-4 py-3">
          <Terminal className="h-4 w-4 text-green-400" />
          <span className="font-mono text-sm text-green-400">Task Console</span>
          <Badge variant={taskStatus === 'completed' ? 'success' : taskStatus === 'failed' ? 'danger' : taskStatus === 'running' ? 'info' : 'warning'}>
            {taskStatus}
          </Badge>
          {phase ? <Badge variant="info">{phase}</Badge> : null}
          {contractAddress ? (
            <a
              href={explorerUrl(chain, contractAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-text"
            >
              {contractAddress.slice(0, 6)}…{contractAddress.slice(-4)}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>

        {/* Console body */}
        <div
          ref={scrollRef}
          className="h-80 overflow-y-auto bg-gray-950 px-4 py-3 font-mono text-xs leading-6"
        >
          {logs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted">
              {isActive ? (
                <span className="animate-pulse">Waiting for execution logs…</span>
              ) : (
                <span>No logs recorded for this task.</span>
              )}
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-2">
                <span className="shrink-0 text-gray-600">{formatTime(log.createdAt)}</span>
                <span className={`shrink-0 ${STATUS_COLORS[log.status] ?? 'text-gray-400'}`}>
                  {STATUS_ICONS[log.status] ?? '·'}
                </span>
                <span className={STATUS_COLORS[log.status] ?? 'text-gray-400'}>
                  {log.message ?? log.event}
                </span>
              </div>
            ))
          )}
          {isActive && logs.length > 0 ? (
            <div className="mt-1 flex items-center gap-2 text-green-400">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green-400" />
              <span>Watching for updates…</span>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-gray-900 px-4 py-2 text-right">
          <span className="font-mono text-xs text-gray-600">Task: {taskId.slice(0, 8)}</span>
        </div>
      </div>
    </Modal>
  );
}
