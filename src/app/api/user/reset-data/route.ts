import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { eq } from 'drizzle-orm';
import {
  mintTasks,
  mintHistory,
  collections,
  analyzerHistory,
  watchedWallets,
} from '@/drizzle/schema';
import { invalidateCache } from '@/lib/redis';

export const dynamic = 'force-dynamic';

/**
 * POST /api/user/reset-data
 *
 * Clears all operational data for the authenticated user:
 *   • Mint tasks (queue + history)
 *   • Blockchain mint history
 *   • Collections watchlist
 *   • Analyzer history
 *   • Watched wallets (whale tracker)
 *
 * KEEPS: account, wallets (with encrypted keys), settings, notifications.
 * This action is IRREVERSIBLE.
 */
export async function POST() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  const { userId } = auth;
  const db = getDb();

  const results: Record<string, number> = {};

  try {
    // Delete in dependency order (children before parents)

    // 1. Analyzer history
    const ah = await db.delete(analyzerHistory).where(eq(analyzerHistory.userId, userId)).returning({ id: analyzerHistory.id });
    results.analyzerHistory = ah.length;

    // 2. Mint history (blockchain receipts)
    const mh = await db.delete(mintHistory).where(eq(mintHistory.userId, userId)).returning({ id: mintHistory.id });
    results.mintHistory = mh.length;

    // 3. Mint tasks (queue)
    const mt = await db.delete(mintTasks).where(eq(mintTasks.userId, userId)).returning({ id: mintTasks.id });
    results.mintTasks = mt.length;

    // 4. Collections watchlist
    const col = await db.delete(collections).where(eq(collections.userId, userId)).returning({ id: collections.id });
    results.collections = col.length;

    // 5. Watched wallets (whale tracker)
    const ww = await db.delete(watchedWallets).where(eq(watchedWallets.userId, userId)).returning({ id: watchedWallets.id });
    results.watchedWallets = ww.length;

    // Invalidate all Redis caches for this user
    await Promise.allSettled([
      invalidateCache(`dep-report:all`),
      invalidateCache(`dep-report:prod`),
    ]);

    const total = Object.values(results).reduce((s, n) => s + n, 0);

    return NextResponse.json({
      ok: true,
      total,
      results,
      message: `${total} record(s) cleared. Your account, wallets, and settings are intact.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reset failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
