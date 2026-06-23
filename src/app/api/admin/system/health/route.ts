import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireApiUser } from '@/lib/auth/require-auth';
import { checkRedisHealth } from '@/lib/redis';
import { getClient } from '@/lib/blockchain/client';
// M-5 fix: replaced dead task.service import with direct mintTasks queries.
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

  // ─── Mint Task Counts (live mintTasks queue) ────────────
  let tasks: Record<string, number> = { pending: 0, running: 0, completed: 0, failed: 0, total: 0 };
  try {
    const rows = await Promise.all([
      getDb().select({ n: count() }).from(mintTasks).where(eq(mintTasks.status, 'pending')),
      getDb().select({ n: count() }).from(mintTasks).where(eq(mintTasks.status, 'running')),
      getDb().select({ n: count() }).from(mintTasks).where(eq(mintTasks.status, 'completed')),
      getDb().select({ n: count() }).from(mintTasks).where(eq(mintTasks.status, 'failed')),
      getDb().select({ n: count() }).from(mintTasks),
    ]);
    tasks = {
      pending:   rows[0][0]?.n ?? 0,
      running:   rows[1][0]?.n ?? 0,
      completed: rows[2][0]?.n ?? 0,
      failed:    rows[3][0]?.n ?? 0,
      total:     rows[4][0]?.n ?? 0,
    };
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
