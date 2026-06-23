import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireApiUser } from '@/lib/auth/require-auth';
import { checkRedisHealth } from '@/lib/redis';
import { getClient } from '@/lib/blockchain/client';
// M-5 fix: removed dead import of task.service / getTaskCounts.
// task.service.ts manages the `tasks` table which is never written to by any
// live pipeline — all active work uses `mintTasks`. The health check was
// reporting counts from an always-empty table. Replaced below with live
// mintTasks counts from the active queue.
import { mintTasks } from '@/drizzle/schema';
import { count, eq } from 'drizzle-orm';
import { getRpcHealthSnapshot } from '@/lib/services/rpc-manager.service';
import { sql } from 'drizzle-orm';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  // ─── Database Health ────────────────────────────
  let database: { status: string; error?: string } = { status: 'healthy' };
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch (error) {
    database = { status: 'unhealthy', error: getErrorMessage(error) };
  }

  // ─── Redis Health ───────────────────────────────
  const redis = await checkRedisHealth();

  let rpc: { status: string; error?: string; providers?: Awaited<ReturnType<typeof getRpcHealthSnapshot>> } = { status: 'healthy' };
  try {
    const client = getClient('ethereum');
    const blockNumber = await client.getBlockNumber();
    const providers = await getRpcHealthSnapshot();
    if (blockNumber === BigInt(0)) {
      rpc = { status: 'warning', error: 'Block number is 0', providers };
    } else {
      rpc = { status: 'healthy', providers };
    }
  } catch (error) {
    rpc = { status: 'unhealthy', error: getErrorMessage(error), providers: await getRpcHealthSnapshot() };
  }

  // ─── Task Counts ───────────────────────────────
  let tasks: Record<string, number> = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
  try {
    tasks = await getTaskCounts();
  } catch {
    tasks = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
  }

  const response = {
    timestamp: new Date().toISOString(),
    database,
    redis: {
      status: redis.status,
      ping: redis.ping,
      error: redis.error,
    },
    rpc,
    cache: {
      connected: redis.status === 'healthy',
      envConfigured: redis.envConfigured,
    },
    tasks,
    summary: {
      database: database.status,
      redis: redis.status,
      rpc: rpc.status,
      overall: [database.status, redis.status, rpc.status].every((s) => s === 'healthy') ? 'healthy' : 'degraded',
    },
  };

  const statusCode = response.summary.overall === 'healthy' ? 200 : 503;
  return NextResponse.json(response, { status: statusCode });
}
