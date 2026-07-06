import 'server-only';

import { Client } from '@upstash/qstash';
import { getDb } from '@/lib/db';
import { mintTasks, collections } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { checkRedisHealth } from '@/lib/redis';
import { getCache } from '@/lib/redis';
import { getRpcHealthSnapshot } from '@/lib/services/rpc-manager.service';

// ── System status / failed-jobs dashboard ──────────────────────────────
//
// Aggregates the health signals that already exist across the app (DB,
// Redis, RPC providers, recovery-loop heartbeat) plus "what recently failed
// and why" into one snapshot for a Settings > System status panel — so you
// don't have to piece it together from logs, the QStash console, and the
// mint history page separately.
// ────────────────────────────────────────────────────────────────────────

export interface ServiceStatus {
  status: 'healthy' | 'unhealthy' | 'unknown';
  detail?: string;
  latencyMs?: number;
}

export interface FailedJob {
  source: 'mint_task' | 'qstash_dlq';
  id: string;
  label: string;
  reason: string;
  failedAt: string | null;
}

export interface SystemStatusSnapshot {
  checkedAt: string;
  database: ServiceStatus;
  redis: ServiceStatus;
  rpc: Record<string, ServiceStatus>;
  recoveryLoop: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    lastHeartbeat: string | null;
    staleAfterMinutes: number;
  };
  failedJobs: FailedJob[];
}

const RECOVERY_HEARTBEAT_CACHE_KEY = 'system:last-recovery-heartbeat';
// The recovery loop self-schedules every 5 minutes; anything older than 3x
// that interval means the self-scheduling chain has likely broken.
const RECOVERY_STALE_AFTER_MINUTES = 15;

async function checkDatabase(): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    await getDb().execute(sql`SELECT 1`);
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'unhealthy',
      detail: error instanceof Error ? error.message : 'Database check failed',
    };
  }
}

async function checkRedis(): Promise<ServiceStatus> {
  try {
    const health = await checkRedisHealth();
    return {
      status: health.status === 'healthy' ? 'healthy' : 'unhealthy',
      latencyMs: health.ping,
      detail: health.error ?? undefined,
    };
  } catch (error) {
    return { status: 'unhealthy', detail: error instanceof Error ? error.message : 'Redis check failed' };
  }
}

async function checkRecoveryLoop() {
  try {
    const lastHeartbeat = await getCache<string>(RECOVERY_HEARTBEAT_CACHE_KEY);
    if (!lastHeartbeat) {
      return { status: 'unknown' as const, lastHeartbeat: null, staleAfterMinutes: RECOVERY_STALE_AFTER_MINUTES };
    }
    const ageMinutes = (Date.now() - new Date(lastHeartbeat).getTime()) / 60_000;
    return {
      status: (ageMinutes <= RECOVERY_STALE_AFTER_MINUTES ? 'healthy' : 'unhealthy') as 'healthy' | 'unhealthy',
      lastHeartbeat,
      staleAfterMinutes: RECOVERY_STALE_AFTER_MINUTES,
    };
  } catch {
    return { status: 'unknown' as const, lastHeartbeat: null, staleAfterMinutes: RECOVERY_STALE_AFTER_MINUTES };
  }
}

/** Recently failed mint tasks for this user, with their last log line as the reason.
 * Never throws -- a query failure here (e.g. a transient DB blip) shouldn't take
 * down the entire status snapshot, so we log and return an empty list instead. */
async function getFailedMintTasks(userId: string, limit = 20): Promise<FailedJob[]> {
  try {
    const { taskLogs } = await import('@/drizzle/schema');

    const failedTasks = await getDb()
      .select({
        id: mintTasks.id,
        contractAddress: mintTasks.contractAddress,
        updatedAt: mintTasks.updatedAt,
        collectionName: collections.name,
      })
      .from(mintTasks)
      .leftJoin(collections, eq(collections.contractAddress, mintTasks.contractAddress))
      .where(and(eq(mintTasks.userId, userId), eq(mintTasks.status, 'failed')))
      .orderBy(desc(mintTasks.updatedAt))
      .limit(limit);

    const jobs: FailedJob[] = [];
    for (const task of failedTasks) {
      const [lastLog] = await getDb()
        .select({ message: taskLogs.message, createdAt: taskLogs.createdAt })
        .from(taskLogs)
        .where(eq(taskLogs.taskId, task.id))
        .orderBy(desc(taskLogs.createdAt))
        .limit(1);

      jobs.push({
        source: 'mint_task',
        id: task.id,
        label: task.collectionName || task.contractAddress || task.id,
        reason: lastLog?.message ?? 'Task failed (no log message recorded)',
        failedAt: task.updatedAt ? new Date(task.updatedAt).toISOString() : null,
      });
    }
    return jobs;
  } catch (_error) {
    return [];
  }
}

/** QStash's own dead-letter queue — jobs that failed at the delivery layer (e.g. signature/URL errors), not just app-level mint failures. */
async function getQStashDeadLetterJobs(limit = 20): Promise<FailedJob[]> {
  const token = process.env.QSTASH_TOKEN;
  if (!token) return [];

  try {
    const client = new Client({ token });
    const { messages } = await client.dlq.listMessages({ count: limit });
    return messages.map((message) => ({
      source: 'qstash_dlq' as const,
      id: message.dlqId,
      label: message.url ?? message.messageId,
      reason: message.responseBody || `HTTP ${message.responseStatus ?? 'unknown'}`,
      failedAt: message.createdAt ? new Date(message.createdAt).toISOString() : null,
    }));
  } catch {
    // QStash API unavailable/misconfigured — don't fail the whole snapshot over it.
    return [];
  }
}

const UNKNOWN_STATUS: ServiceStatus = { status: 'unknown', detail: 'Health check failed to run' };
const UNKNOWN_RECOVERY_LOOP = { status: 'unknown' as const, lastHeartbeat: null, staleAfterMinutes: RECOVERY_STALE_AFTER_MINUTES };

/** Runs a settled promise, logging + falling back to `fallback` on rejection
 * instead of letting one bad check take down the whole snapshot. */
async function settleOrFallback<T>(promise: Promise<T>, fallback: T, _checkName: string): Promise<T> {
  const result = await Promise.allSettled([promise]);
  const [outcome] = result;
  if (outcome.status === 'fulfilled') return outcome.value;
  return fallback;
}

export async function getSystemStatusSnapshot(userId: string): Promise<SystemStatusSnapshot> {
  // Each check is isolated: a failure in one (e.g. RPC health lookup) falls
  // back to 'unknown' for just that item instead of nulling the whole
  // snapshot, so the dashboard still shows real status for everything else.
  const [database, redis, rpc, recoveryLoop, mintJobs, dlqJobs] = await Promise.all([
    settleOrFallback(checkDatabase(), UNKNOWN_STATUS, 'database'),
    settleOrFallback(checkRedis(), UNKNOWN_STATUS, 'redis'),
    settleOrFallback(getRpcHealthSnapshot(), {} as Awaited<ReturnType<typeof getRpcHealthSnapshot>>, 'rpc'),
    settleOrFallback(checkRecoveryLoop(), UNKNOWN_RECOVERY_LOOP, 'recovery-loop'),
    getFailedMintTasks(userId),
    getQStashDeadLetterJobs(),
  ]);

  const rpcStatus: Record<string, ServiceStatus> = {};
  for (const [provider, health] of Object.entries(rpc)) {
    const h = health as { consecutiveFailures?: number; unhealthyUntil?: number; lastFailure?: string | null };
    const isOpen = !!h.unhealthyUntil && Date.now() < h.unhealthyUntil;
    rpcStatus[provider] = {
      status: isOpen ? 'unhealthy' : 'healthy',
      detail: h.lastFailure ?? undefined,
    };
  }

  const failedJobs = [...mintJobs, ...dlqJobs].sort((a, b) => {
    const at = a.failedAt ? new Date(a.failedAt).getTime() : 0;
    const bt = b.failedAt ? new Date(b.failedAt).getTime() : 0;
    return bt - at;
  });

  return {
    checkedAt: new Date().toISOString(),
    database,
    redis,
    rpc: rpcStatus,
    recoveryLoop,
    failedJobs,
  };
}
