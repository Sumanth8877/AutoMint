import { NextResponse } from 'next/server';
import { and, desc, eq, gte, ilike, or, sql, type SQL } from 'drizzle-orm';
import { analyzerHistory } from '@/drizzle/schema';
import { getErrorMessage } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';

// Disable ISR — history data must reflect recent mints immediately
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const RECENT_DAYS = 7;

function getPaging(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  return { page, limit, offset: (page - 1) * limit };
}

function combineFilters(filters: Array<SQL | undefined>) {
  return and(...filters.filter((filter): filter is SQL => Boolean(filter)));
}

function searchFilter(search: string | null) {
  const query = search?.trim();
  if (!query) return undefined;
  const pattern = `%${query}%`;
  return or(
    ilike(analyzerHistory.collectionName, pattern),
    ilike(analyzerHistory.contractAddress, pattern),
    ilike(analyzerHistory.input, pattern),
    ilike(analyzerHistory.sourceUrl, pattern),
  );
}

function historyFilter(value: string | null) {
  switch (value?.toLowerCase()) {
    case 'ethereum':
    case 'base':
    case 'polygon':
    case 'solana':
      return eq(analyzerHistory.chain, value.toLowerCase());
    case 'recent':
      return gte(analyzerHistory.createdAt, new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000));
    default:
      return undefined;
  }
}

export async function GET(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { searchParams } = new URL(req.url);
    const { page, limit, offset } = getPaging(searchParams);
    const whereClause = combineFilters([
      eq(analyzerHistory.userId, authResult.userId),
      historyFilter(searchParams.get('filter')),
      searchFilter(searchParams.get('search')),
    ]);

    const [items, countRows] = await Promise.all([
      getDb()
        .select({
          id: analyzerHistory.id,
          input: analyzerHistory.input,
          sourceUrl: analyzerHistory.sourceUrl,
          collectionName: analyzerHistory.collectionName,
          contractAddress: analyzerHistory.contractAddress,
          chain: analyzerHistory.chain,
          riskScore: analyzerHistory.riskScore,
          riskLevel: analyzerHistory.riskLevel,
          riskFactors: analyzerHistory.riskFactors,
          floorPrice: analyzerHistory.floorPrice,
          floorCurrency: analyzerHistory.floorCurrency,
          floorSymbol: analyzerHistory.floorSymbol,
          ownerCount: analyzerHistory.ownerCount,
          volume: analyzerHistory.volume,
          marketStatus: analyzerHistory.marketStatus,
          healthScore: analyzerHistory.healthScore,
          opportunityScore: analyzerHistory.opportunityScore,
          readinessScore: analyzerHistory.readinessScore,
          mintState: analyzerHistory.mintState,
          providerUsed: analyzerHistory.providerUsed,
          cacheUsed: analyzerHistory.cacheUsed,
          rpcProviderUsed: analyzerHistory.rpcProviderUsed,
          socials: analyzerHistory.socials,
          socialCount: analyzerHistory.socialCount,
          analysisDurationMs: analyzerHistory.analysisDurationMs,
          createdAt: analyzerHistory.createdAt,
        })
        .from(analyzerHistory)
        .where(whereClause)
        .orderBy(desc(analyzerHistory.createdAt))
        .limit(limit)
        .offset(offset),
      getDb()
        .select({ total: sql<number>`count(*)` })
        .from(analyzerHistory)
        .where(whereClause),
    ]);

    const total = Number(countRows[0]?.total ?? 0);
    return NextResponse.json({
      items,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to load analyzer history') }, { status: 500 });
  }
}
