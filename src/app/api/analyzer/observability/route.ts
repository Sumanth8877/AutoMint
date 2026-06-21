import { NextResponse } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { analyticsEvents, analyzerHistory } from '@/drizzle/schema';
import { getErrorMessage } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { getRpcHealthSnapshot, getRpcRoutingSnapshot } from '@/lib/services/rpc-manager.service';

type ProviderAttempt = {
  provider: string;
  status: 'success' | 'failed';
  durationMs: number;
};

const PROVIDERS = ['OpenSea API', 'Firecrawl', 'Jina', 'Reservoir'] as const;

function configured(provider: string) {
  if (provider === 'OpenSea API') return true;
  if (provider === 'Reservoir') return true;
  if (provider === 'Firecrawl') return Boolean(process.env.FIRECRAWL_API_KEY);
  if (provider === 'Jina') return Boolean(process.env.JINA_API_KEY || process.env.JINA_READER_API_KEY);
  return false;
}

function percent(part: number, total: number) {
  if (total === 0) return null;
  return Math.round((part / total) * 100);
}

function average(values: number[]) {
  if (!values.length) return null;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const [historyRows, rpcSnapshot, rpcHealth, failoverRows, failoverCountRows] = await Promise.all([
      getDb()
        .select({
          id: analyzerHistory.id,
          providerUsed: analyzerHistory.providerUsed,
          rpcProviderUsed: analyzerHistory.rpcProviderUsed,
          providerChain: analyzerHistory.providerChain,
          analysisDurationMs: analyzerHistory.analysisDurationMs,
          createdAt: analyzerHistory.createdAt,
        })
        .from(analyzerHistory)
        .where(eq(analyzerHistory.userId, authResult.userId))
        .orderBy(desc(analyzerHistory.createdAt))
        .limit(500),
      getRpcRoutingSnapshot(authResult.userId, 'ethereum'),
      getRpcHealthSnapshot(),
      getDb()
        .select({
          provider: analyticsEvents.provider,
          metadata: analyticsEvents.metadata,
          createdAt: analyticsEvents.createdAt,
        })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.status, 'failover'))
        .orderBy(desc(analyticsEvents.createdAt))
        .limit(1),
      getDb()
        .select({ total: sql<number>`count(*)` })
        .from(analyticsEvents)
        .where(eq(analyticsEvents.status, 'failover')),
    ]);

    const attemptsByProvider = new Map<string, Array<ProviderAttempt & { createdAt: Date }>>();
    const recentErrors: Array<{ service: string; message: string; createdAt: string }> = [];

    for (const row of historyRows) {
      for (const attempt of row.providerChain ?? []) {
        const attempts = attemptsByProvider.get(attempt.provider) ?? [];
        attempts.push({ ...attempt, createdAt: row.createdAt });
        attemptsByProvider.set(attempt.provider, attempts);
        if (attempt.status === 'failed') {
          recentErrors.push({
            service: attempt.provider,
            message: `${attempt.provider} failed during provider resolution`,
            createdAt: row.createdAt.toISOString(),
          });
        }
      }
    }

    for (const [provider, health] of Object.entries(rpcHealth)) {
      if (health.lastFailure) {
        recentErrors.push({
          service: provider === 'alchemy' ? 'Alchemy' : 'QuickNode',
          message: health.lastFailure,
          createdAt: health.lastFailureAt ?? new Date().toISOString(),
        });
      }
    }

    const serviceHealth = PROVIDERS.map((provider) => {
      const attempts = attemptsByProvider.get(provider) ?? [];
      const successes = attempts.filter((attempt) => attempt.status === 'success');
      const failures = attempts.filter((attempt) => attempt.status === 'failed');
      const lastSuccess = successes.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
      const lastFailure = failures.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];

      return {
        service: provider,
        configured: configured(provider),
        healthy: successes.length > 0 ? (!lastFailure || lastSuccess.createdAt >= lastFailure.createdAt) : null,
        lastSuccess: lastSuccess?.createdAt.toISOString() ?? null,
        lastFailure: lastFailure?.createdAt.toISOString() ?? null,
        averageLatencyMs: average(attempts.map((attempt) => attempt.durationMs)),
      };
    });

    const rpcServiceHealth = rpcSnapshot.providers.map((provider) => {
      const key = provider.provider === 'ALCHEMY' ? 'alchemy' : 'quicknode';
      const health = rpcHealth[key];
      return {
        service: provider.provider === 'ALCHEMY' ? 'Alchemy' : 'QuickNode',
        configured: provider.configured,
        healthy: provider.healthy,
        lastSuccess: health.lastSuccessAt ?? health.lastRestoredAt,
        lastFailure: health.lastFailureAt ?? null,
        averageLatencyMs: provider.latency,
      };
    });

    const providerRates = PROVIDERS.map((provider) => {
      const attempts = attemptsByProvider.get(provider) ?? [];
      const successes = attempts.filter((attempt) => attempt.status === 'success').length;
      const failures = attempts.filter((attempt) => attempt.status === 'failed').length;
      const total = successes + failures;
      return {
        provider,
        successPercent: percent(successes, total),
        failurePercent: percent(failures, total),
        successes,
        failures,
      };
    });

    const currentProvider = rpcSnapshot.currentActiveProvider === 'ALCHEMY'
      ? 'Alchemy'
      : rpcSnapshot.currentActiveProvider === 'QUICKNODE'
        ? 'QuickNode'
        : null;
    const currentProviderRow = rpcSnapshot.providers.find((provider) => provider.provider === rpcSnapshot.currentActiveProvider);
    const failoverCount = Number(failoverCountRows[0]?.total ?? 0);
    const lastFailover = failoverRows[0]?.createdAt?.toISOString() ?? null;
    if (failoverRows[0]) {
      recentErrors.push({
        service: failoverRows[0].provider ?? 'RPC',
        message: 'RPC failover triggered',
        createdAt: failoverRows[0].createdAt.toISOString(),
      });
    }

    const totalAnalyses = historyRows.length;
    const averageAnalysisTimeMs = average(historyRows.map((row) => row.analysisDurationMs));

    return NextResponse.json({
      analyzerMetrics: {
        totalAnalyses,
        successfulAnalyses: totalAnalyses,
        failedAnalyses: null,
        successRate: null,
        averageAnalysisTimeMs,
      },
      serviceHealth: [...serviceHealth, ...rpcServiceHealth],
      providerRates,
      rpcMonitoring: {
        currentPrimaryProvider: currentProvider,
        currentLatencyMs: currentProviderRow?.latency ?? null,
        failoverCount,
        lastFailover,
      },
      recentErrors: recentErrors
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        .slice(0, 8),
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to load analyzer observability') }, { status: 500 });
  }
}
