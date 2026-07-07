import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { resetUserActivityData } from '@/lib/services/reset-data.service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/user/reset-data
 *
 * Clears history data for the authenticated user:
 *   • Blockchain mint history
 *   • Analyzer history
 *   • Collections
 *
 * KEEPS: mint queue, wallets, watched wallets, account,
 *        settings, notifications. This action is IRREVERSIBLE.
 *
 * M-02 fix: delegates to the single shared resetUserActivityData()
 * implementation also used by /api/settings/reset-data, so both endpoints
 * are guaranteed to behave identically.
 */
export async function POST() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const { results, total } = await resetUserActivityData(auth.userId);

    return NextResponse.json({
      ok: true,
      total,
      results,
      message: `${total} record(s) cleared. Your account, wallets, and settings are intact. Collections cleared.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reset failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
