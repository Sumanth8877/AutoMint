import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { resetUserActivityData } from '@/lib/services/reset-data.service';

// Deletes activity/history data for the current user.
// Wallets, the mint queue, watched wallets, and settings are preserved.
//
// M-02 fix: this endpoint previously had its own divergent implementation
// that ALSO deleted mintTasks (the active/pending mint queue) -- silently
// cancelling scheduled mints, unlike its sibling /api/user/reset-data (the
// one actually wired to the UI), which explicitly preserves the queue.
// Both routes now delegate to the same resetUserActivityData() function so
// "reset data" means one consistent thing everywhere it can be triggered
// (UI, or the documented AUTOMINT_API_KEY bearer flow).
export async function DELETE() {
  try {
    const auth = await requireApiUser();
    if ('error' in auth) return auth.error;

    const { results, total } = await resetUserActivityData(auth.userId);

    return NextResponse.json({
      success: true,
      total,
      results,
      message: `${total} record(s) cleared. Wallets, the mint queue, and settings are intact.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reset data' },
      { status: 500 },
    );
  }
}
