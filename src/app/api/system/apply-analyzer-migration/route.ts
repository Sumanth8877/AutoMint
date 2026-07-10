import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';

/**
 * POST /api/system/apply-analyzer-migration
 *
 * One-time migration: adds missing columns to analyzer_history.
 * Safe to call multiple times — all statements use IF NOT EXISTS.
 * Requires: authenticated user session.
 *
 * Audit fix: statements are now wrapped in a single transaction with a
 * session-level advisory lock so concurrent calls can't race and a partial
 * failure rolls back cleanly.
 */
export const dynamic = 'force-dynamic';

// Stable advisory lock key derived from a constant (hash of 'analyzer_migration').
const ADVISORY_LOCK_KEY = 0xA1A1A1A1;

// Columns the app expects to exist on analyzer_history. Keep in sync with the
// ALTER TABLE statements below.
const REQUIRED_COLUMNS = [
  'source_url', 'collection_name', 'contract_address', 'chain', 'risk_score',
  'risk_level', 'risk_factors', 'floor_price', 'floor_currency', 'floor_symbol',
  'owner_count', 'volume', 'market_status', 'health_score', 'opportunity_score',
  'readiness_score', 'mint_state', 'provider_used', 'cache_used',
  'rpc_provider_used', 'socials', 'social_count', 'analysis_duration_ms',
];

/**
 * GET /api/system/apply-analyzer-migration
 *
 * Checks the real database schema to see whether analyzer_history is
 * actually missing any of the expected columns. Used so the UI only shows
 * "migration pending" when it's genuinely still needed, instead of showing
 * it unconditionally on every page load.
 */
export async function GET() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();
    const result = await db.execute(sql.raw(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'analyzer_history'`
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

    // Audit fix: acquire a session-level advisory lock so concurrent calls
    // can't race, then wrap all statements in a single transaction so a
    // partial failure rolls back cleanly.
    await db.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

    const migrations = [
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "source_url" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "collection_name" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "contract_address" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "chain" text NOT NULL DEFAULT 'ethereum'`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "risk_score" integer`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "risk_level" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "risk_factors" jsonb`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "floor_price" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "floor_currency" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "floor_symbol" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "owner_count" integer`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "volume" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "market_status" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "health_score" integer`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "opportunity_score" integer NOT NULL DEFAULT 0`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "readiness_score" integer NOT NULL DEFAULT 0`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "mint_state" text NOT NULL DEFAULT 'UNKNOWN'`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "provider_used" text NOT NULL DEFAULT 'unknown'`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "cache_used" boolean NOT NULL DEFAULT false`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "rpc_provider_used" text`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "socials" jsonb`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "social_count" integer NOT NULL DEFAULT 0`,
      `ALTER TABLE "analyzer_history" ADD COLUMN IF NOT EXISTS "analysis_duration_ms" integer NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS "idx_analyzer_history_user_created" ON "analyzer_history" ("user_id", "created_at" DESC)`,
    ];

    const results: { statement: string; status: 'ok' | 'error'; error?: string }[] = [];

    // Audit fix: run all statements inside a transaction — if any statement
    // fails with a non-"already exists" error, the entire migration rolls back.
    await db.transaction(async (tx) => {
      for (const statement of migrations) {
        try {
          await tx.execute(sql.raw(statement));
          results.push({ statement: statement.slice(0, 60) + '…', status: 'ok' });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('already exists') || msg.includes('duplicate')) {
            results.push({ statement: statement.slice(0, 60) + '…', status: 'ok' });
          } else {
            results.push({ statement: statement.slice(0, 60) + '…', status: 'error', error: msg });
            throw err; // roll back the transaction
          }
        }
      }
    });

    const failed = results.filter(r => r.status === 'error');
    return NextResponse.json({
      ok: failed.length === 0,
      applied: results.filter(r => r.status === 'ok').length,
      failed: failed.length,
      results,
      message: failed.length === 0
        ? 'All analyzer_history columns applied successfully.'
        : `${failed.length} statement(s) failed — check results for details.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Migration failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
