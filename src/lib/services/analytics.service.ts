import 'server-only';

import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { analyticsEvents, mintHistory, mintTasks } from '@/drizzle/schema';

type AnalyticsStatus = 'success' | 'failed' | 'scheduled' | 'executed' | 'triggered';

type AnalyticsEventInput = {
  userId?: string | null;
  eventType: string;
  status: AnalyticsStatus | string;
  provider?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
};

export type ChartPoint = {
  label: string;
  value: number;
  secondary?: number;
};

export type AnalyticsDashboard = {
  kpis: {
    totalMints: number;
    successfulMints: number;
    successRate: number;
    failedMints: number;
    scheduledMints: number;
    executedScheduledMints: number;
    averageRiskScore: number;
    highRiskCollections: number;
  };
  spendAnalytics: {
    totalSpendEth: number;
    averageMintCostEth: number;
    highestMintCostEth: number;
    lowestMintCostEth: number;
  };
  mintPerformance: {
    successfulMints: number;
    failedMints: number;
    successRate: number;
    mintsOverTime: ChartPoint[];
    successVsFailure: ChartPoint[];
  };
  executionPerformance: {
    averageExecutionTimeSeconds: number;
    fastestExecutionSeconds: number;
    slowestExecutionSeconds: number;
    averageRpcLatencyMs: number;
  };
  riskAnalytics: {
    collectionsAnalyzed: number;
    averageRiskScore: number;
    lowRiskCount: number;
    mediumRiskCount: number;
    highRiskCount: number;
    criticalRiskCount: number;
  };
  hasData: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 14;

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round(value: number, places = 4) {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
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

function secondsBetween(start: Date | null, end: Date | null) {
  if (!start || !end) return null;
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  return Number.isFinite(seconds) ? seconds : null;
}

function buildMintsOverTime(rows: Array<{ createdAt: Date; status: string }>) {
  return lastDays(CHART_DAYS).map((label) => {
    const dailyRows = rows.filter((row) => dayKey(row.createdAt) === label);
    return {
      label,
      value: dailyRows.length,
      secondary: dailyRows.filter((row) => row.status === 'completed').length,
    };
  });
}

function buildSuccessVsFailure(successfulMints: number, failedMints: number) {
  return [
    { label: 'Successful', value: successfulMints },
    { label: 'Failed', value: failedMints },
  ];
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
  } catch (_error) {
  }
}

export async function getAnalyticsDashboard(userId: string): Promise<AnalyticsDashboard> {
  try {
    const chartStart = new Date(Date.now() - (CHART_DAYS - 1) * DAY_MS);

    const [
      [mintStats],
      [spendStats],
      executionRows,
      chartRows,
      [rpcLatency],
    ] = await Promise.all([
      getDb()
        .select({
          totalMints: sql<number>`count(*)::int`,
          successfulMints: sql<number>`count(*) filter (where ${mintTasks.status} = 'completed')::int`,
          failedMints: sql<number>`count(*) filter (where ${mintTasks.status} = 'failed')::int`,
          scheduledMints: sql<number>`count(*) filter (where ${mintTasks.scheduledTime} is not null or ${mintTasks.qstashMessageId} is not null)::int`,
          executedScheduledMints: sql<number>`count(*) filter (where (${mintTasks.scheduledTime} is not null or ${mintTasks.qstashMessageId} is not null) and ${mintTasks.status} = 'completed')::int`,
          collectionsAnalyzed: sql<number>`count(distinct coalesce(${mintTasks.collectionId}::text, ${mintTasks.contractAddress})) filter (where ${mintTasks.riskScore} is not null)::int`,
          averageRiskScore: sql<string>`coalesce(avg(${mintTasks.riskScore}) filter (where ${mintTasks.riskScore} is not null), 0)::text`,
          lowRiskCount: sql<number>`count(*) filter (where ${mintTasks.riskScore} between 0 and 25)::int`,
          mediumRiskCount: sql<number>`count(*) filter (where ${mintTasks.riskScore} between 26 and 50)::int`,
          highRiskCount: sql<number>`count(*) filter (where ${mintTasks.riskScore} between 51 and 75)::int`,
          criticalRiskCount: sql<number>`count(*) filter (where ${mintTasks.riskScore} between 76 and 100)::int`,
        })
        .from(mintTasks)
        .where(eq(mintTasks.userId, userId)),
      getDb()
        .select({
          totalSpendEth: sql<string>`
            coalesce(sum(
              case when ${mintTasks.mintPrice} ~ '^[0-9]+([.][0-9]+)?$'
                then ${mintTasks.mintPrice}::numeric * ${mintTasks.quantity}
                else 0
              end
              +
              case when ${mintHistory.gasUsed} ~ '^[0-9]+([.][0-9]+)?$'
                then ${mintHistory.gasUsed}::numeric / 1000000000000000000
                else 0
              end
            ), 0)::text
          `,
          averageMintCostEth: sql<string>`
            coalesce(avg(
              case when ${mintTasks.mintPrice} ~ '^[0-9]+([.][0-9]+)?$'
                then ${mintTasks.mintPrice}::numeric * ${mintTasks.quantity}
                else 0
              end
              +
              case when ${mintHistory.gasUsed} ~ '^[0-9]+([.][0-9]+)?$'
                then ${mintHistory.gasUsed}::numeric / 1000000000000000000
                else 0
              end
            ), 0)::text
          `,
          highestMintCostEth: sql<string>`
            coalesce(max(
              case when ${mintTasks.mintPrice} ~ '^[0-9]+([.][0-9]+)?$'
                then ${mintTasks.mintPrice}::numeric * ${mintTasks.quantity}
                else 0
              end
              +
              case when ${mintHistory.gasUsed} ~ '^[0-9]+([.][0-9]+)?$'
                then ${mintHistory.gasUsed}::numeric / 1000000000000000000
                else 0
              end
            ), 0)::text
          `,
          lowestMintCostEth: sql<string>`
            coalesce(min(
              case when ${mintTasks.mintPrice} ~ '^[0-9]+([.][0-9]+)?$'
                then ${mintTasks.mintPrice}::numeric * ${mintTasks.quantity}
                else 0
              end
              +
              case when ${mintHistory.gasUsed} ~ '^[0-9]+([.][0-9]+)?$'
                then ${mintHistory.gasUsed}::numeric / 1000000000000000000
                else 0
              end
            ), 0)::text
          `,
        })
        .from(mintTasks)
        .leftJoin(
          mintHistory,
          and(
            eq(mintHistory.userId, mintTasks.userId),
            eq(mintHistory.transactionHash, mintTasks.txHash),
          ),
        )
        .where(and(eq(mintTasks.userId, userId), isNotNull(mintTasks.confirmedAt))),
      getDb()
        .select({
          createdAt: mintTasks.createdAt,
          confirmedAt: mintTasks.confirmedAt,
        })
        .from(mintTasks)
        .where(and(eq(mintTasks.userId, userId), isNotNull(mintTasks.confirmedAt))),
      getDb()
        .select({
          createdAt: mintTasks.createdAt,
          status: mintTasks.status,
        })
        .from(mintTasks)
        .where(and(eq(mintTasks.userId, userId), sql`${mintTasks.createdAt} >= ${chartStart}`))
        .orderBy(asc(mintTasks.createdAt)),
      getDb()
        .select({
          averageRpcLatencyMs: sql<string>`coalesce(avg(${analyticsEvents.durationMs}) filter (where ${analyticsEvents.durationMs} is not null), 0)::text`,
        })
        .from(analyticsEvents)
        .where(and(eq(analyticsEvents.userId, userId), eq(analyticsEvents.eventType, 'rpc'))),
    ]);

    const successfulMints = mintStats?.successfulMints ?? 0;
    const failedMints = mintStats?.failedMints ?? 0;
    const totalMints = mintStats?.totalMints ?? 0;
    const averageRiskScore = Math.round(toNumber(mintStats?.averageRiskScore));
    const executionSeconds = executionRows
      .map((row) => secondsBetween(row.createdAt, row.confirmedAt))
      .filter((value): value is number => value !== null);

    return {
      kpis: {
        totalMints,
        successfulMints,
        successRate: percent(successfulMints, successfulMints + failedMints),
        failedMints,
        scheduledMints: mintStats?.scheduledMints ?? 0,
        executedScheduledMints: mintStats?.executedScheduledMints ?? 0,
        averageRiskScore,
        highRiskCollections: (mintStats?.highRiskCount ?? 0) + (mintStats?.criticalRiskCount ?? 0),
      },
      spendAnalytics: {
        totalSpendEth: round(toNumber(spendStats?.totalSpendEth)),
        averageMintCostEth: round(toNumber(spendStats?.averageMintCostEth)),
        highestMintCostEth: round(toNumber(spendStats?.highestMintCostEth)),
        lowestMintCostEth: round(toNumber(spendStats?.lowestMintCostEth)),
      },
      mintPerformance: {
        successfulMints,
        failedMints,
        successRate: percent(successfulMints, successfulMints + failedMints),
        mintsOverTime: buildMintsOverTime(chartRows),
        successVsFailure: buildSuccessVsFailure(successfulMints, failedMints),
      },
      executionPerformance: {
        averageExecutionTimeSeconds: executionSeconds.length > 0
          ? Math.round(executionSeconds.reduce((sum, value) => sum + value, 0) / executionSeconds.length)
          : 0,
        fastestExecutionSeconds: executionSeconds.length > 0 ? Math.min(...executionSeconds) : 0,
        slowestExecutionSeconds: executionSeconds.length > 0 ? Math.max(...executionSeconds) : 0,
        averageRpcLatencyMs: Math.round(toNumber(rpcLatency?.averageRpcLatencyMs)),
      },
      riskAnalytics: {
        collectionsAnalyzed: mintStats?.collectionsAnalyzed ?? 0,
        averageRiskScore,
        lowRiskCount: mintStats?.lowRiskCount ?? 0,
        mediumRiskCount: mintStats?.mediumRiskCount ?? 0,
        highRiskCount: mintStats?.highRiskCount ?? 0,
        criticalRiskCount: mintStats?.criticalRiskCount ?? 0,
      },
      hasData: totalMints > 0 || (mintStats?.collectionsAnalyzed ?? 0) > 0,
    };
  } catch (error) {
    throw error;
  }
}
