import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminApiSession } from '@/lib/auth/require-auth';
import { checkRedisHealth } from '@/lib/redis';
import { getClient } from '@/lib/blockchain/client';
import { getTaskCounts } from '@/lib/services/task.service';
import { sql } from 'drizzle-orm';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function GET() {
  const authResult = await requireAdminApiSession();
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

  // ─── Alchemy Health (check Ethereum RPC) ────────
  let alchemy: { status: string; error?: string } = { status: 'healthy' };
  try {
    const client = getClient('ethereum');
    const blockNumber = await client.getBlockNumber();
    if (blockNumber === BigInt(0)) {
      alchemy = { status: 'warning', error: 'Block number is 0' };
    }
  } catch (error) {
    alchemy = { status: 'unhealthy', error: getErrorMessage(error) };
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
    alchemy,
    quicknode: {
      status: 'unknown',
      note: 'QuickNode configured via ALCHEMY_RPC env vars as fallback',
    },
    cache: {
      connected: redis.status === 'healthy',
      envConfigured: redis.envConfigured,
    },
    tasks,
    summary: {
      database: database.status,
      redis: redis.status,
      alchemy: alchemy.status,
      overall: [database.status, redis.status, alchemy.status].every((s) => s === 'healthy') ? 'healthy' : 'degraded',
    },
  };

  const statusCode = response.summary.overall === 'healthy' ? 200 : 503;
  return NextResponse.json(response, { status: statusCode });
}
