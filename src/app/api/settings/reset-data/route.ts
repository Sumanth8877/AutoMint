import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { analyzerHistory, mintHistory, mintTasks } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { captureException } from '@/lib/observability/sentry';

// Deletes all activity data for the current user.
// Wallets, collections, watched wallets, and settings are preserved.
export async function DELETE() {
  try {
    const auth = await requireApiUser();
    if ('error' in auth) return auth.error;
    const { userId } = auth;

    const db = getDb();

    // Delete in order respecting FK constraints:
    // mintHistory → mintTasks → analyzerHistory
    await db.delete(mintHistory).where(eq(mintHistory.userId, userId));
    await db.delete(mintTasks).where(eq(mintTasks.userId, userId));
    await db.delete(analyzerHistory).where(eq(analyzerHistory.userId, userId));

    return NextResponse.json({
      success: true,
      message: 'All activity data deleted. Wallets, collections, and settings are intact.',
    });
  } catch (error) {
    await captureException(error, {
      area: 'settings',
      fingerprint: ['settings', 'reset-data'],
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reset data' },
      { status: 500 },
    );
  }
}
