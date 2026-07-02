import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';

/**
 * POST /api/system/apply-collections-migration
 *
 * One-time migration: adds floor-price-movement columns to `collections`.
 * Safe to call multiple times -- all statements use IF NOT EXISTS.
 * Requires: authenticated user session. Follows the same self-serve
 * migration pattern as /api/system/apply-analyzer-migration.
 */
export const dynamic = 'force-dynamic';

const REQUIRED_COLUMNS = ['previous_floor_price', 'floor_change_percent'];

/**
 * GET /api/system/apply-collections-migration
 *
 * Checks the real database schema to see whether `collections` is actually
 * missing any of the expected columns, so the UI only prompts for migration
 * when it's genuinely still needed.
 */
export async function GET() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    const result = await db.execute(sql.raw(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'collections'`
    ));
    const rows = (result as unknown as { rows: { column_name: string }[] }).rows ?? [];
    const existing = new Set(rows.map((r) => r.column_name));
    const missing = REQUIRED_COLUMNS.filter((c) => !existing.has(c));
    return NextResponse.json({ pending: missing.length > 0, missing });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Status check failed';
    return NextResponse.json({ pending: true, error: message }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();

    const migrations = [
      `ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "previous_floor_price" text`,
      `ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "floor_change_percent" text`,
    ];

    const results: { statement: string; status: 'ok' | 'error'; error?: string }[] = [];

    for (const statement of migrations) {
      try {
        await db.execute(sql.raw(statement));
        results.push({ statement: statement.slice(0, 60) + '…', status: 'ok' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          results.push({ statement: statement.slice(0, 60) + '…', status: 'ok' });
        } else {
          results.push({ statement: statement.slice(0, 60) + '…', status: 'error', error: msg });
        }
      }
    }

    const failed = results.filter(r => r.status === 'error');
    return NextResponse.json({
      ok: failed.length === 0,
      applied: results.filter(r => r.status === 'ok').length,
      failed: failed.length,
      results,
      message: failed.length === 0
        ? 'All collections columns applied successfully.'
        : `${failed.length} statement(s) failed — check results for details.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Migration failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
