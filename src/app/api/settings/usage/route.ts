import 'server-only';
import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { addBreadcrumb } from '@/lib/observability/sentry';

export const dynamic = 'force-dynamic';

// ── Types ─────────────────────────────────────────────────────────────────────

export type UsageStat = {
  service: string;
  label: string;
  icon: string;
  used: number | null;
  limit: number | null;
  unit: string;
  period: string;
  /** 0–100, null if we couldn't fetch usage */
  pct: number | null;
  tip: string;
  /** whether the API call for this service succeeded */
  ok: boolean;
  error?: string;
};

type UsageResponse = {
  stats: UsageStat[];
  fetchedAt: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(used: number, limit: number): number {
  return Math.min(100, Math.round((used / limit) * 100));
}

function env(key: string): string | undefined {
  return process.env[key];
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

/** Upstash Redis — INFO command via the REST API */
async function fetchRedisUsage(): Promise<UsageStat> {
  const base: UsageStat = {
    service: 'Upstash Redis',
    label: 'Redis Commands Today',
    icon: '⚡',
    used: null, limit: 10_000, unit: 'commands', period: 'today',
    pct: null, ok: false,
    tip: 'Free tier: 10,000 commands/day. Resets at midnight UTC.',
  };

  const url = env('KV_REST_API_URL') ?? env('UPSTASH_REDIS_REST_URL');
  const token = env('KV_REST_API_TOKEN') ?? env('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return { ...base, error: 'Redis credentials not configured' };

  try {
    // Use the Upstash REST API to execute INFO stats command
    const res = await fetch(`${url}/info`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { result: string };
    const info = data.result ?? '';

    // Parse total_commands_processed and uptime_in_seconds from INFO output
    const cmdMatch = info.match(/total_commands_processed:(\d+)/);
    const uptimeMatch = info.match(/uptime_in_seconds:(\d+)/);
    const memMatch = info.match(/used_memory:(\d+)/);
    const maxMemMatch = info.match(/maxmemory:(\d+)/);

    const totalCmds = cmdMatch ? parseInt(cmdMatch[1]) : null;
    const uptimeSec = uptimeMatch ? parseInt(uptimeMatch[1]) : null;
    const usedMem = memMatch ? parseInt(memMatch[1]) : null;
    const maxMem = maxMemMatch ? parseInt(maxMemMatch[1]) : null;

    // Estimate today's commands: if uptime < 1 day, total is today's total
    // Otherwise, we can't know daily count without the management API
    const isUpLessThanDay = uptimeSec !== null && uptimeSec < 86_400;
    const todayCmds = isUpLessThanDay ? totalCmds : null;

    // Also return memory usage as a separate insight
    const memMB = usedMem ? Math.round(usedMem / (1024 * 1024)) : null;
    const maxMemMB = maxMem && maxMem > 0 ? Math.round(maxMem / (1024 * 1024)) : 256; // free tier = 256 MB

    return {
      ...base,
      used: todayCmds,
      limit: 10_000,
      pct: todayCmds !== null ? pct(todayCmds, 10_000) : null,
      ok: true,
      tip: memMB
        ? `Free tier: 10,000 commands/day, 256 MB storage. Memory: ${memMB} MB / ${maxMemMB} MB.`
        : base.tip,
    };
  } catch (err) {
    addBreadcrumb({ category: 'usage', message: 'Redis usage fetch failed', level: 'warning', data: { error: String(err) } });
    return { ...base, error: String(err) };
  }
}

/** Upstash QStash — daily message stats */
async function fetchQStashUsage(): Promise<UsageStat> {
  const base: UsageStat = {
    service: 'QStash',
    label: 'Messages This Month',
    icon: '📨',
    used: null, limit: 500, unit: 'messages', period: 'this month',
    pct: null, ok: false,
    tip: 'Free tier: 500 messages/month.',
  };

  const token = env('QSTASH_TOKEN');
  if (!token) return { ...base, error: 'QSTASH_TOKEN not configured' };

  try {
    // QStash v2 stats endpoint
    const res = await fetch('https://qstash.upstash.io/v2/stats', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
      messagesSent?: number;
      successRate?: number;
      dailySent?: Array<{ time: string; sent: number; delivered: number; failed: number }>;
    };

    // Sum up the current month from dailySent
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthlyTotal = (data.dailySent ?? [])
      .filter(d => d.time.startsWith(monthPrefix))
      .reduce((sum, d) => sum + (d.sent ?? 0), 0);

    const used = monthlyTotal > 0 ? monthlyTotal : (data.messagesSent ?? null);

    return {
      ...base,
      used,
      pct: used !== null ? pct(used, 500) : null,
      ok: true,
      tip: `Free tier: 500 messages/month. Success rate: ${data.successRate !== undefined ? Math.round(data.successRate * 100) + '%' : 'unknown'}.`,
    };
  } catch (err) {
    addBreadcrumb({ category: 'usage', message: 'QStash usage fetch failed', level: 'warning', data: { error: String(err) } });
    return { ...base, error: String(err) };
  }
}

/** Neon PostgreSQL — database size via a direct query */
async function fetchNeonUsage(): Promise<UsageStat> {
  const base: UsageStat = {
    service: 'Neon',
    label: 'Database Size',
    icon: '🗄️',
    used: null, limit: 512, unit: 'MB', period: 'total',
    pct: null, ok: false,
    tip: 'Free tier: 512 MB storage. Includes all tables, indexes, and WAL.',
  };

  try {
    const result = await getDb().execute(sql`
      SELECT
        pg_database_size(current_database()) AS size_bytes,
        pg_size_pretty(pg_database_size(current_database())) AS size_pretty
    `);
    const row = result.rows?.[0] as { size_bytes: string; size_pretty: string } | undefined;
    if (!row) throw new Error('No result from size query');

    const bytes = parseInt(row.size_bytes);
    const mb = Math.round(bytes / (1024 * 1024) * 10) / 10; // 1 decimal

    return {
      ...base,
      used: mb,
      pct: pct(mb, 512),
      ok: true,
      tip: `Free tier: 512 MB storage. Current: ${row.size_pretty}.`,
    };
  } catch (err) {
    addBreadcrumb({ category: 'usage', message: 'Neon usage fetch failed', level: 'warning', data: { error: String(err) } });
    return { ...base, error: String(err) };
  }
}

/** Clerk — total user count */
async function fetchClerkUsage(): Promise<UsageStat> {
  const base: UsageStat = {
    service: 'Clerk',
    label: 'Monthly Active Users',
    icon: '👤',
    used: null, limit: 10_000, unit: 'MAU', period: 'this month',
    pct: null, ok: false,
    tip: 'Free tier: 10,000 monthly active users.',
  };

  const key = env('CLERK_SECRET_KEY');
  if (!key) return { ...base, error: 'CLERK_SECRET_KEY not configured' };

  try {
    const res = await fetch('https://api.clerk.com/v1/users/count', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { total_count?: number };
    const used = data.total_count ?? null;

    return {
      ...base,
      used,
      pct: used !== null ? pct(used, 10_000) : null,
      ok: true,
      tip: `Free tier: 10,000 MAU. You have ${used ?? '?'} registered user(s).`,
    };
  } catch (err) {
    addBreadcrumb({ category: 'usage', message: 'Clerk usage fetch failed', level: 'warning', data: { error: String(err) } });
    return { ...base, error: String(err) };
  }
}

/** Jina AI — token usage from their API */
async function fetchJinaUsage(): Promise<UsageStat> {
  const base: UsageStat = {
    service: 'Jina AI',
    label: 'API Tokens Used',
    icon: '🔍',
    used: null, limit: 1_000_000, unit: 'tokens', period: 'total',
    pct: null, ok: false,
    tip: 'Free tier: 1M tokens total.',
  };

  const key = env('JINA_API_KEY');
  if (!key) return { ...base, error: 'Not configured' };

  try {
    const res = await fetch('https://r.jina.ai/usage', {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { balance?: number; total?: number; used?: number };
    // Jina returns balance (tokens remaining)
    const balance = data.balance ?? data.total ?? null;
    const used = balance !== null ? Math.max(0, 1_000_000 - balance) : (data.used ?? null);

    return {
      ...base,
      used,
      pct: used !== null ? pct(used, 1_000_000) : null,
      ok: true,
    };
  } catch (err) {
    return { ...base, error: String(err) };
  }
}

/** Firecrawl — credits usage */
async function fetchFirecrawlUsage(): Promise<UsageStat> {
  const base: UsageStat = {
    service: 'Firecrawl',
    label: 'Credits Used',
    icon: '🔥',
    used: null, limit: 500, unit: 'credits', period: 'this month',
    pct: null, ok: false,
    tip: 'Free tier: 500 credits/month (1 credit = 1 page scraped).',
  };

  const key = env('FIRECRAWL_API_KEY');
  if (!key) return { ...base, error: 'Not configured' };

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/team/usage', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as {
      credits_used?: number;
      credits_limit?: number;
      plan?: string;
    };
    const used = data.credits_used ?? null;
    const limit = data.credits_limit ?? 500;

    return {
      ...base,
      used,
      limit,
      pct: used !== null ? pct(used, limit) : null,
      ok: true,
      tip: `Plan: ${data.plan ?? 'free'}. ${used ?? '?'} / ${limit} credits used this month.`,
    };
  } catch (err) {
    return { ...base, error: String(err) };
  }
}

/** Alchemy — no public usage API on free tier; return static info */
function buildAlchemyStat(): UsageStat {
  const configured = Boolean(env('ALCHEMY_API_KEY'));
  return {
    service: 'Alchemy',
    label: 'Compute Units',
    icon: '⛓️',
    used: null, limit: 300_000_000, unit: 'CU', period: 'this month',
    pct: null,
    ok: configured,
    tip: configured
      ? 'Free tier: 300M compute units/month. Check usage at dashboard.alchemy.com.'
      : 'ALCHEMY_API_KEY not configured.',
    error: configured ? undefined : 'Not configured — check dashboard.alchemy.com for usage',
  };
}

/** Vercel — no API without a personal token; return static note */
function buildVercelStat(): UsageStat {
  return {
    service: 'Vercel',
    label: 'Serverless Invocations',
    icon: '▲',
    used: null, limit: 100_000, unit: 'invocations', period: 'this month',
    pct: null, ok: true,
    tip: 'Hobby plan: 100K serverless invocations/month. Check usage at vercel.com/dashboard.',
  };
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  // Fetch all available usage stats in parallel
  const [redis, qstash, neon, clerk, jina, firecrawl] = await Promise.all([
    fetchRedisUsage(),
    fetchQStashUsage(),
    fetchNeonUsage(),
    fetchClerkUsage(),
    fetchJinaUsage(),
    fetchFirecrawlUsage(),
  ]);

  const response: UsageResponse = {
    stats: [redis, qstash, neon, clerk, jina, firecrawl, buildAlchemyStat(), buildVercelStat()],
    fetchedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
