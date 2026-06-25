import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { collections, mintHistory, mintTasks, wallets } from '@/drizzle/schema';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { addMintTask } from '@/lib/services/mint.service';
import { cancelScheduledMint, scheduleMint } from '@/lib/services/qstash.service';

// Cache GET requests for 4 hours
export const revalidate = 14400;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const MINT_STATUS_MAP = {
  success: ['completed'],
  failed: ['failed'],
  pending: ['pending', 'ready', 'running'],
  cancelled: ['cancelled'],
} as const;

const SCHEDULED_STATUS_MAP = {
  scheduled: ['monitoring'],
  waiting: ['pending', 'ready'],
  executing: ['running'],
  completed: ['completed'],
  failed: ['failed'],
  cancelled: ['cancelled'],
} as const;

function getPaging(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  return { page, limit, offset: (page - 1) * limit };
}

function searchFilter(search: string | null) {
  const query = search?.trim();
  if (!query) return undefined;
  const pattern = `%${query}%`;
  return or(
    ilike(collections.name, pattern),
    ilike(collections.contractAddress, pattern),
    ilike(wallets.nickname, pattern),
    ilike(wallets.address, pattern),
  );
}

function riskFilter(value: string | null) {
  switch (value) {
    case 'low':
      return and(sql`${mintTasks.riskScore} >= 0`, sql`${mintTasks.riskScore} <= 25`);
    case 'medium':
      return and(sql`${mintTasks.riskScore} >= 26`, sql`${mintTasks.riskScore} <= 50`);
    case 'high':
      return and(sql`${mintTasks.riskScore} >= 51`, sql`${mintTasks.riskScore} <= 75`);
    case 'critical':
      return and(sql`${mintTasks.riskScore} >= 76`, sql`${mintTasks.riskScore} <= 100`);
    default:
      return undefined;
  }
}

function combineFilters(filters: Array<SQL | undefined>) {
  return and(...filters.filter((filter): filter is SQL => Boolean(filter)));
}

async function countRows(whereClause: SQL | undefined) {
  const [row] = await getDb()
    .select({ total: sql<number>`count(*)` })
    .from(mintTasks)
    .leftJoin(collections, eq(mintTasks.collectionId, collections.id))
    .leftJoin(wallets, eq(mintTasks.walletId, wallets.id))
    .leftJoin(mintHistory, and(
      eq(mintHistory.userId, mintTasks.userId),
      eq(mintHistory.transactionHash, mintTasks.txHash),
    ))
    .where(whereClause);

  return Number(row?.total ?? 0);
}

async function getMintHistory(userId: string, searchParams: URLSearchParams) {
  const { page, limit, offset } = getPaging(searchParams);
  const status = searchParams.get('status')?.toLowerCase();
  const mappedStatus = status && status in MINT_STATUS_MAP
    ? MINT_STATUS_MAP[status as keyof typeof MINT_STATUS_MAP]
    : undefined;
  const whereClause = combineFilters([
    eq(mintTasks.userId, userId),
    mappedStatus ? inArray(mintTasks.status, [...mappedStatus]) : inArray(mintTasks.status, ['completed', 'failed', 'pending', 'ready', 'running', 'cancelled']),
    searchFilter(searchParams.get('search')),
  ]);

  const [items, total] = await Promise.all([
    getDb()
      .select({
        id: mintTasks.id,
        collectionName: collections.name,
        contractAddress: mintTasks.contractAddress,
        walletName: wallets.nickname,
        walletAddress: wallets.address,
        quantity: mintTasks.quantity,
        mintPrice: mintTasks.mintPrice,
        gasUsed: mintHistory.gasUsed,
        status: mintTasks.status,
        transactionHash: mintTasks.txHash,
        executionStartedAt: mintTasks.createdAt,
        executionCompletedAt: mintTasks.confirmedAt,
        updatedAt: mintTasks.updatedAt,
      })
      .from(mintTasks)
      .leftJoin(collections, eq(mintTasks.collectionId, collections.id))
      .leftJoin(wallets, eq(mintTasks.walletId, wallets.id))
      .leftJoin(mintHistory, and(
        eq(mintHistory.userId, mintTasks.userId),
        eq(mintHistory.transactionHash, mintTasks.txHash),
      ))
      .where(whereClause)
      .orderBy(desc(mintTasks.createdAt))
      .limit(limit)
      .offset(offset),
    countRows(whereClause),
  ]);

  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

async function getScheduledTasks(userId: string, searchParams: URLSearchParams) {
  const { page, limit, offset } = getPaging(searchParams);
  const status = searchParams.get('status')?.toLowerCase();
  const mappedStatus = status && status in SCHEDULED_STATUS_MAP
    ? SCHEDULED_STATUS_MAP[status as keyof typeof SCHEDULED_STATUS_MAP]
    : undefined;
  const whereClause = combineFilters([
    eq(mintTasks.userId, userId),
    mappedStatus ? inArray(mintTasks.status, [...mappedStatus]) : undefined,
    searchFilter(searchParams.get('search')),
  ]);

  const [items, total] = await Promise.all([
    getDb()
      .select({
        id: mintTasks.id,
        collectionId: mintTasks.collectionId,
        collectionName: collections.name,
        contractAddress: mintTasks.contractAddress,
        walletId: mintTasks.walletId,
        walletName: wallets.nickname,
        walletAddress: wallets.address,
        quantity: mintTasks.quantity,
        status: mintTasks.status,
        scheduledTime: mintTasks.scheduledTime,
        createdAt: mintTasks.createdAt,
        updatedAt: mintTasks.updatedAt,
      })
      .from(mintTasks)
      .leftJoin(collections, eq(mintTasks.collectionId, collections.id))
      .leftJoin(wallets, eq(mintTasks.walletId, wallets.id))
      .where(whereClause)
      .orderBy(desc(mintTasks.scheduledTime), desc(mintTasks.createdAt))
      .limit(limit)
      .offset(offset),
    countRows(whereClause),
  ]);

  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

async function getAnalyzerHistory(userId: string, searchParams: URLSearchParams) {
  const { page, limit, offset } = getPaging(searchParams);
  const whereClause = combineFilters([
    eq(mintTasks.userId, userId),
    sql`${mintTasks.riskScore} is not null`,
    riskFilter(searchParams.get('risk')),
    searchFilter(searchParams.get('search')),
  ]);

  const [items, total] = await Promise.all([
    getDb()
      .select({
        id: mintTasks.id,
        collectionId: mintTasks.collectionId,
        collectionName: collections.name,
        contractAddress: mintTasks.contractAddress,
        riskScore: mintTasks.riskScore,
        riskReasons: mintTasks.riskReasons,
        analyzedAt: mintTasks.updatedAt,
      })
      .from(mintTasks)
      .leftJoin(collections, eq(mintTasks.collectionId, collections.id))
      .leftJoin(wallets, eq(mintTasks.walletId, wallets.id))
      .where(whereClause)
      .orderBy(desc(mintTasks.updatedAt))
      .limit(limit)
      .offset(offset),
    countRows(whereClause),
  ]);

  return { items, page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

export async function GET(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { searchParams } = new URL(req.url);
    const tab = searchParams.get('tab') ?? 'mints';

    if (tab === 'scheduled') {
      return NextResponse.json({ tab, ...await getScheduledTasks(authResult.userId, searchParams) });
    }

    if (tab === 'analyzer') {
      return NextResponse.json({ tab, ...await getAnalyzerHistory(authResult.userId, searchParams) });
    }

    return NextResponse.json({ tab: 'mints', ...await getMintHistory(authResult.userId, searchParams) });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to load history') }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{
      taskId?: string;
      action?: 'cancel' | 'duplicate' | 'edit';
      scheduledTime?: string;
      quantity?: number;
    }>(req);

    if (!body.taskId || !body.action) {
      return NextResponse.json({ error: 'Task ID and action are required' }, { status: 400 });
    }

    const [existing] = await getDb()
      .select()
      .from(mintTasks)
      .where(and(eq(mintTasks.id, body.taskId), eq(mintTasks.userId, authResult.userId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (body.action === 'cancel') {
      const task = await cancelScheduledMint(existing.id, authResult.userId);
      return NextResponse.json({ task });
    }

    if (body.action === 'duplicate') {
      if (!existing.walletId || !existing.collectionId) {
        return NextResponse.json({ error: 'Task is missing wallet or collection' }, { status: 400 });
      }

      const duplicated = await addMintTask(authResult.userId, {
        walletId: existing.walletId,
        collectionId: existing.collectionId,
        quantity: existing.quantity,
        safeModeEnabled: existing.safeModeEnabled,
        gasStrategy: existing.gasStrategy,
        maxRetries: existing.maxRetries,
        riskThreshold: existing.riskThreshold,
      });

      const scheduledTime = existing.scheduledTime && existing.scheduledTime.getTime() > Date.now()
        ? existing.scheduledTime
        : undefined;

      const task = await scheduleMint({ taskId: duplicated.id, userId: authResult.userId, scheduledTime });
      return NextResponse.json({ task });
    }

    const scheduledTime = body.scheduledTime ? new Date(body.scheduledTime) : existing.scheduledTime;
    const quantity = body.quantity ? Math.max(1, Math.floor(body.quantity)) : existing.quantity;

    if (body.scheduledTime && Number.isNaN(scheduledTime?.getTime())) {
      return NextResponse.json({ error: 'Scheduled time is invalid' }, { status: 400 });
    }

    await getDb()
      .update(mintTasks)
      .set({ quantity, updatedAt: new Date() })
      .where(and(eq(mintTasks.id, existing.id), eq(mintTasks.userId, authResult.userId)));

    const task = scheduledTime
      ? await scheduleMint({ taskId: existing.id, userId: authResult.userId, scheduledTime })
      : existing;

    return NextResponse.json({ task });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to update history task');
    const status = message === 'Invalid JSON request body' ? 400 : message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
