import 'server-only';

import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  activities,
  analyticsEvents,
  consensusEvents,
  mintHistory,
  mintTasks,
  watchedWallets,
} from '@/drizzle/schema';
import { getRpcHealthSnapshot } from '@/lib/services/rpc-manager.service';
import { getMostAccurateWallets, getMostSuccessfulCopyMintSources, getWalletReputationLeaderboard } from '@/lib/services/wallet-reputation.service';
import { getRiskLearningMetrics, getRiskWeightHistory } from '@/lib/services/risk-learning.service';
import { captureException } from '@/lib/observability/sentry';

type AnalyticsStatus = 'success' | 'failed' | 'scheduled' | 'executed' | 'triggered';

type AnalyticsEventInput = {
  userId?: string | null;
  eventType: string;
  status: AnalyticsStatus | string;
  provider?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
};

type ChartPoint = {
  label: string;
  value: number;
  secondary?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function since(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function dayKey(date: Date) {
  return date.toISOString().slice(5, 10);
}

function lastDays(days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.now() - (days - index - 1) * DAY_MS);
    return dayKey(date);
  });
}

export async function trackAnalyticsEvent(input: AnalyticsEventInput) {
  try {
    await getDb().insert(analyticsEvents).values({
      userId: input.userId ?? null,
      eventType: input.eventType,
      status: input.status,
      provider: input.provider ?? null,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata,
    });
  } catch (error) {
    await captureException(error, {
      area: 'analytics',
      context: { userId: input.userId ?? undefined, provider: input.provider ?? undefined },
      extra: { eventType: input.eventType, status: input.status },
      fingerprint: ['analytics', 'track-event'],
    });
  }
}

function countEvents(
  rows: Array<{ eventType: string; status: string; provider: string | null }>,
  eventType: string,
  status?: string,
  provider?: string,
) {
  return rows.filter((row) => (
    row.eventType === eventType
    && (!status || row.status === status)
    && (!provider || row.provider === provider)
  )).length;
}

function rateForProvider(rows: Array<{ eventType: string; status: string; provider: string | null }>, provider: string) {
  const total = rows.filter((row) => row.eventType === 'discovery' && row.provider === provider).length;
  const success = rows.filter((row) => row.eventType === 'discovery' && row.provider === provider && row.status === 'success').length;
  return percent(success, total);
}

function dailyMints(tasks: Array<{ createdAt: Date; status: string }>): ChartPoint[] {
  return lastDays(14).map((label) => {
    const rows = tasks.filter((task) => dayKey(task.createdAt) === label);
    return {
      label,
      value: rows.length,
      secondary: rows.filter((task) => task.status === 'completed').length,
    };
  });
}

function successRateSeries(tasks: Array<{ createdAt: Date; status: string }>): ChartPoint[] {
  return lastDays(14).map((label) => {
    const rows = tasks.filter((task) => dayKey(task.createdAt) === label);
    return {
      label,
      value: percent(rows.filter((task) => task.status === 'completed').length, rows.length),
    };
  });
}

function discoveryLatency(events: Array<{ eventType: string; provider: string | null; durationMs: number | null; createdAt: Date }>): ChartPoint[] {
  return lastDays(14).map((label) => {
    const rows = events.filter((event) => event.eventType === 'discovery' && dayKey(event.createdAt) === label);
    return { label, value: average(rows.map((event) => event.durationMs)) };
  });
}

function riskDistribution(tasks: Array<{ riskScore: number | null }>): ChartPoint[] {
  const scores = tasks.map((task) => task.riskScore).filter((score): score is number => typeof score === 'number');
  return [
    { label: '0-24', value: scores.filter((score) => score < 25).length },
    { label: '25-49', value: scores.filter((score) => score >= 25 && score < 50).length },
    { label: '50-74', value: scores.filter((score) => score >= 50 && score < 75).length },
    { label: '75-100', value: scores.filter((score) => score >= 75).length },
  ];
}

export async function getAnalyticsDashboard(userId: string) {
  try {
    const since30 = since(30);
    const [
      userMintTasks,
      userMintHistory,
      userActivities,
      userWatchedWallets,
      globalAnalyticsEvents,
      allConsensusEvents,
      rpcHealth,
      reputationLeaderboard,
      accurateWallets,
      copyMintSources,
      riskLearningMetrics,
      riskWeightHistory,
    ] = await Promise.all([
      getDb().select().from(mintTasks).where(and(eq(mintTasks.userId, userId), gte(mintTasks.createdAt, since30))),
      getDb().select().from(mintHistory).where(and(eq(mintHistory.userId, userId), gte(mintHistory.createdAt, since30))),
      getDb().select().from(activities).where(and(eq(activities.userId, userId), gte(activities.createdAt, since30))).orderBy(desc(activities.createdAt)).limit(100),
      getDb().select().from(watchedWallets).where(and(eq(watchedWallets.userId, userId), eq(watchedWallets.active, true))),
      getDb().select().from(analyticsEvents).where(and(or(eq(analyticsEvents.userId, userId), sql`${analyticsEvents.userId} is null`), gte(analyticsEvents.createdAt, since30))),
      getDb().select().from(consensusEvents).where(gte(consensusEvents.detectedAt, since30)),
      getRpcHealthSnapshot(),
      getWalletReputationLeaderboard(10),
      getMostAccurateWallets(10),
      getMostSuccessfulCopyMintSources(10),
      getRiskLearningMetrics(),
      getRiskWeightHistory(10),
    ]);

    const completedMints = userMintTasks.filter((task) => task.status === 'completed').length;
    const failedMints = userMintTasks.filter((task) => task.status === 'failed').length;
    const totalMints = userMintTasks.length;
    const scheduledMints = userMintTasks.filter((task) => task.qstashMessageId || task.scheduledTime || task.status === 'monitoring').length;
    const cancelledMints = userMintTasks.filter((task) => task.status === 'cancelled').length;
    const executedMints = userMintHistory.length || completedMints;
    const highRisk = userMintTasks.filter((task) => (task.riskScore ?? 0) >= 50).length;
    const lowRisk = userMintTasks.filter((task) => typeof task.riskScore === 'number' && task.riskScore < 50).length;
    const detectedMints = userActivities.filter((activity) => activity.title.toLowerCase().includes('wallet minted nft')).length;
    const copyMintTriggers = userActivities.filter((activity) => activity.title.toLowerCase().includes('copy mint')).length;
    const consensusTriggers = userActivities.filter((activity) => activity.title.toLowerCase().includes('whale consensus')).length;
    const successfulConsensusMints = userActivities.filter((activity) => activity.title.toLowerCase().includes('consensus copy mint') || activity.title.toLowerCase().includes('mint executed')).length;

    const alchemyRequests = rpcHealth.alchemy.successCount + rpcHealth.alchemy.errorCount;
    const quicknodeRequests = rpcHealth.quicknode.successCount + rpcHealth.quicknode.errorCount;
    const failoverCount = countEvents(globalAnalyticsEvents, 'rpc', 'failover') + Number(rpcHealth.alchemy.consecutiveFailures >= 3);
    const jobsScheduled = countEvents(globalAnalyticsEvents, 'qstash', 'scheduled');
    const jobsExecuted = countEvents(globalAnalyticsEvents, 'qstash', 'executed');
    const jobFailures = countEvents(globalAnalyticsEvents, 'qstash', 'failed');
    const messagesSent = countEvents(globalAnalyticsEvents, 'telegram', 'success');
    const messageFailures = countEvents(globalAnalyticsEvents, 'telegram', 'failed');

    return {
      mintMetrics: {
        totalMints,
        successfulMints: completedMints,
        failedMints,
        successRate: percent(completedMints, completedMints + failedMints),
      },
      schedulingMetrics: {
        scheduledMints,
        executedMints,
        cancelledMints,
      },
      discoveryMetrics: {
        jinaSuccessRate: rateForProvider(globalAnalyticsEvents, 'jina'),
        firecrawlSuccessRate: rateForProvider(globalAnalyticsEvents, 'firecrawl'),
        averageDiscoveryTime: average(globalAnalyticsEvents.filter((event) => event.eventType === 'discovery').map((event) => event.durationMs)),
      },
      riskMetrics: {
        averageRiskScore: average(userMintTasks.map((task) => task.riskScore)),
        highRiskCount: highRisk,
        lowRiskCount: lowRisk,
        predictionAccuracy: riskLearningMetrics.predictionAccuracy,
        riskEngineConfidence: riskLearningMetrics.riskEngineConfidence,
        falsePositives: riskLearningMetrics.falsePositives,
        falseNegatives: riskLearningMetrics.falseNegatives,
      },
      walletTrackerMetrics: {
        trackedWallets: userWatchedWallets.length,
        detectedMints,
        copyMintTriggers,
      },
      whaleConsensusMetrics: {
        consensusTriggers,
        successfulConsensusMints,
        uniqueConsensusCollections: new Set(allConsensusEvents.map((event) => event.collection)).size,
        whaleConsensusAccuracy: riskLearningMetrics.whaleConsensusAccuracy,
      },
      rpcMetrics: {
        alchemyRequests,
        quicknodeRequests,
        failoverCount,
        alchemyLatency: rpcHealth.alchemy.responseTime,
        quicknodeLatency: rpcHealth.quicknode.responseTime,
      },
      qstashMetrics: {
        jobsScheduled,
        jobsExecuted,
        jobFailures,
      },
      telegramMetrics: {
        messagesSent,
        messageFailures,
      },
      charts: {
        dailyMints: dailyMints(userMintTasks),
        successRate: successRateSeries(userMintTasks),
        discoveryLatency: discoveryLatency(globalAnalyticsEvents),
        rpcUsage: [
          { label: 'Alchemy', value: alchemyRequests },
          { label: 'QuickNode', value: quicknodeRequests },
        ],
        riskDistribution: riskDistribution(userMintTasks),
        learnedRiskDistribution: riskLearningMetrics.scoreDistribution,
      },
      walletReputation: {
        leaderboard: reputationLeaderboard,
        mostAccurate: accurateWallets,
        copyMintSources,
      },
      riskLearning: {
        ...riskLearningMetrics,
        weightHistory: riskWeightHistory,
      },
      recentEvents: userActivities.slice(0, 12).map((activity) => ({
        id: activity.id,
        title: activity.title,
        type: activity.type,
        createdAt: activity.createdAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    await captureException(error, {
      area: 'analytics',
      context: { userId },
      fingerprint: ['analytics', 'dashboard'],
    });
    throw error;
  }
}
