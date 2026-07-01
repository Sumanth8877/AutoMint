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
 */
export const dynamic = 'force-dynamic';

export async function POST() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const db = getDb();

    // Add each missing column individually so one failure doesn't block others
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

    for (const statement of migrations) {
      try {
        await db.execute(sql.raw(statement));
        results.push({ statement: statement.slice(0, 60) + '…', status: 'ok' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // "already exists" errors are OK — column or index already present
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
        ? 'All analyzer_history columns applied successfully.'
        : `${failed.length} statement(s) failed — check results for details.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Migration failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
