'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { useState } from 'react';
import { apiRequest } from '@/lib/api/client';

interface AIStatusResponse {
  gemini: {
    status: 'healthy' | 'degraded' | 'down';
    consecutiveFailures: number;
    lastFailureAt: number | null;
    lastSuccessAt: number | null;
    lastError: string | null;
    downSince: number | null;
  };
  nara: {
    status: 'healthy' | 'degraded' | 'down';
  };
  activeProvider: string;
  fallbackActive: boolean;
}

function formatTimeSince(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Dashboard banner that shows when Gemini is down and Nara is serving requests.
 * Polls /api/ai/status every 30s. Auto-hides when Gemini recovers.
 */
export function AIProviderBanner() {
  const [dismissed, setDismissed] = useState(false);

  const { data: status } = useQuery<AIStatusResponse>({
    queryKey: ['ai-status'],
    queryFn: () => apiRequest<AIStatusResponse>('/api/ai/status'),
    refetchInterval: 30_000, // Poll every 30s
    staleTime: 15_000,
  });

  // Don't show if no data yet, or if Gemini is healthy, or if user dismissed
  if (!status || !status.fallbackActive || dismissed) return null;

  // Auto-un-dismiss when status changes (Gemini comes back up, goes down again)
  const geminiDown = status.gemini.status === 'down';
  if (!geminiDown) return null;

  return (
    <div className="relative flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-200">
          Gemini AI is currently unavailable
        </p>
        <p className="text-xs text-amber-300/80 mt-0.5">
          {status.gemini.lastError && (
            <span className="truncate block max-w-md">
              Error: {status.gemini.lastError.slice(0, 100)}
            </span>
          )}
          {status.gemini.downSince && (
            <span>Down since {formatTimeSince(status.gemini.downSince)} • </span>
          )}
          Using <strong>Nara (Mistral)</strong> as fallback — AI features remain fully operational.
          {status.gemini.consecutiveFailures > 0 && (
            <span> • {status.gemini.consecutiveFailures} consecutive failures</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="flex items-center gap-1.5 rounded-full bg-green-500/20 px-2.5 py-1 text-xs font-medium text-green-400">
          <CheckCircle className="h-3 w-3" />
          Nara Active
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="rounded p-1 text-amber-400/60 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Small inline status indicator for settings or header.
 */
export function AIProviderStatus() {
  const { data: status } = useQuery<AIStatusResponse>({
    queryKey: ['ai-status'],
    queryFn: () => apiRequest<AIStatusResponse>('/api/ai/status'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  if (!status) return null;

  const isHealthy = status.gemini.status === 'healthy' && !status.fallbackActive;

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${isHealthy ? 'text-green-400' : 'text-amber-400'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${isHealthy ? 'bg-green-400' : 'bg-amber-400 animate-pulse'}`} />
      {isHealthy ? `Gemini` : `Nara (fallback)`}
    </span>
  );
}
