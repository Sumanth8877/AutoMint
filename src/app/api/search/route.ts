import { NextResponse } from 'next/server';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { collections, mintTasks, wallets } from '@/drizzle/schema';
import { getErrorMessage } from '@/lib/api/errors';

export async function GET(request: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim() ?? '';

    if (query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const pattern = `%${query}%`;
    const userId = authResult.userId;

    const [walletRows, collectionRows, taskRows] = await Promise.all([
      getDb()
        .select({
          id: wallets.id,
          title: wallets.nickname,
          fallbackTitle: wallets.address,
          subtitle: wallets.chain,
          walletType: wallets.walletType,
        })
        .from(wallets)
        .where(and(eq(wallets.userId, userId), or(ilike(wallets.address, pattern), ilike(wallets.nickname, pattern))))
        .limit(5),
      getDb()
        .select({
          id: collections.id,
          title: collections.name,
          fallbackTitle: collections.contractAddress,
          subtitle: collections.chain,
        })
        .from(collections)
        .where(and(eq(collections.userId, userId), or(ilike(collections.name, pattern), ilike(collections.contractAddress, pattern))))
        .limit(5),
      getDb()
        .select({
          id: mintTasks.id,
          title: mintTasks.contractAddress,
          fallbackTitle: mintTasks.status,
          subtitle: mintTasks.status,
          createdAt: mintTasks.createdAt,
        })
        .from(mintTasks)
        .where(and(eq(mintTasks.userId, userId), or(ilike(mintTasks.contractAddress, pattern), ilike(mintTasks.status, pattern))))
        .orderBy(desc(mintTasks.createdAt))
        .limit(5),
    ]);

    const results = [
      ...walletRows.map((row) => ({
        id: row.id,
        type: 'wallet' as const,
        title: row.title || row.fallbackTitle,
        subtitle: row.walletType === 'EVM' ? `${row.walletType} / ${row.subtitle}` : row.walletType,
        href: '/wallets',
      })),
      ...collectionRows.map((row) => ({
        id: row.id,
        type: 'collection' as const,
        title: row.title || row.fallbackTitle,
        subtitle: row.subtitle,
        href: '/collections',
      })),
      ...taskRows.map((row) => ({
        id: row.id,
        type: 'mint' as const,
        title: row.title || `Mint task ${row.id.slice(0, 8)}`,
        subtitle: row.subtitle,
        href: '/mints',
      })),
    ];

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Search failed') }, { status: 500 });
  }
}
