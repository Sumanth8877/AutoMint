import 'server-only';

import { and, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { monitoredWebsites } from '@/drizzle/schema';
import { addBreadcrumb } from '@/lib/observability/sentry';

// ── Constants ─────────────────────────────────────────────────────────────────

// Snapshots older than this are pruned entirely (the row is kept, only
// lastSnapshot is nullified). Keeps the table lean for long-running monitors.
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Sites not checked in this window have their snapshot cleared — they'll get
// a fresh baseline on the next check cycle.
const SITE_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Types ─────────────────────────────────────────────────────────────────────

export type CleanupResult = {
  /** Number of rows whose lastSnapshot was cleared */
  snapshotsCleared: number;
  /** Timestamp of the cleanup run */
  ranAt: string;
};

// ── Cleanup function ──────────────────────────────────────────────────────────
//
// Called from the QStash recovery job (mint-recovery.service.ts) so it runs
// automatically every recovery interval (~5 min) without needing a dedicated
// cron endpoint.
//
// What it does:
//   - Clears lastSnapshot for sites whose snapshot is older than 7 days.
//     The JSONB column is set to NULL rather than keeping a stale blob.
//   - Clears lastSnapshot for sites not checked in >24 hours (stale monitors
//     that were paused or missed cycles).
//
// What it does NOT do:
//   - Delete rows (users may resume monitoring paused sites).
//   - Touch the lastChecked, status, or any config columns.
//
export async function pruneMonitoredWebsiteSnapshots(): Promise<CleanupResult> {
  const db = getDb();
  const now = new Date();
  const snapshotCutoff = new Date(Date.now() - SNAPSHOT_MAX_AGE_MS);
  const staleCutoff     = new Date(Date.now() - SITE_STALE_THRESHOLD_MS);

  // Nullify snapshots that are too old OR belong to stale monitors.
  // Uses a single UPDATE with an OR condition to minimise round-trips.
  const result = await db
    .update(monitoredWebsites)
    .set({ lastSnapshot: null })
    .where(
      and(
        isNotNull(monitoredWebsites.lastSnapshot),
        sql`(
          ${monitoredWebsites.lastChecked} < ${snapshotCutoff}
          OR ${monitoredWebsites.lastChecked} < ${staleCutoff}
          OR ${monitoredWebsites.lastChecked} IS NULL
        )`,
      ),
    )
    .returning({ id: monitoredWebsites.id });

  const snapshotsCleared = result.length;

  addBreadcrumb({
    category: 'db-cleanup',
    message: 'monitoredWebsites snapshot prune completed',
    level: 'info',
    data: { snapshotsCleared, ranAt: now.toISOString() },
  });

  return { snapshotsCleared, ranAt: now.toISOString() };
}
