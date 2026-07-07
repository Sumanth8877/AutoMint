import 'server-only';

import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { analyzerHistory, collections, mintHistory } from '@/drizzle/schema';
import { invalidateCache } from '@/lib/redis';

// M-02 fix: this codebase previously had two independent "reset data"
// implementations (`/api/settings/reset-data` and `/api/user/reset-data`)
// that had silently diverged:
//   - /api/user/reset-data (the one actually wired to the UI) deleted
//     analyzerHistory, mintHistory, and collections -- and explicitly KEPT
//     the mint queue (mintTasks).
//   - /api/settings/reset-data (unreferenced by the frontend, but reachable
//     directly via the documented AUTOMINT_API_KEY bearer flow) also deleted
//     mintTasks -- silently cancelling any pending/scheduled mints, which is
//     not what "reset my history" implies and is not what the UI does.
//
// This single shared function is now the one source of truth for what
// "reset data" means. Both routes call it so their behavior can never drift
// apart again. It intentionally preserves the mint queue, collections'
// parent wallets, watched wallets, account, and settings -- only clears
// history/analytics-style records.
export type ResetUserDataResult = {
  results: Record<string, number>;
  total: number;
};

export async function resetUserActivityData(userId: string): Promise<ResetUserDataResult> {
  const results: Record<string, number> = {};

  await getDb().transaction(async (tx) => {
    const ah = await tx.delete(analyzerHistory).where(eq(analyzerHistory.userId, userId)).returning({ id: analyzerHistory.id });
    results.analyzerHistory = ah.length;

    const mh = await tx.delete(mintHistory).where(eq(mintHistory.userId, userId)).returning({ id: mintHistory.id });
    results.mintHistory = mh.length;

    const cl = await tx.delete(collections).where(eq(collections.userId, userId)).returning({ id: collections.id });
    results.collections = cl.length;
  });

  // Invalidate all Redis caches for this user (best-effort; non-fatal).
  await Promise.allSettled([
    invalidateCache(`dep-report:all`),
    invalidateCache(`dep-report:prod`),
  ]);

  const total = Object.values(results).reduce((s, n) => s + n, 0);
  return { results, total };
}
