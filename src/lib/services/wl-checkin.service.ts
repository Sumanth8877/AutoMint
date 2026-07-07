import 'server-only';

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trackedProjects, wlCheckinLog } from '@/drizzle/schema/wl-tracker';
import { getTrackedProject } from '@/lib/services/wl-tracker.service';
import { ValidationError } from '@/lib/api/errors';

// ─── WL Daily Check-in service ───────────────────────────────────────────
// Many NFT projects require a daily "check-in" — visit the site, click a
// button, retweet the daily post — to accrue WL points. If you miss a day,
// you lose progress. This service:
//   - Enables/disables the daily-check-in flag on a project.
//   - Marks a check-in as done (append-only log for streak calculations).
//   - Lists projects whose check-in is still pending "today" in the user's
//     timezone (default UTC — customized per user via `timezoneOverride`).

// ─── Types ───────────────────────────────────────────────────────────────

export type CheckinPending = {
  projectId: string;
  projectName: string;
  twitterHandle: string;
  projectAvatarUrl: string | null;
  dailyCheckinUrl: string | null;
  dailyCheckinTimeHint: string | null;
  lastDoneAt: Date | null;
  streakDays: number;
};

// ─── Enable / disable ────────────────────────────────────────────────────

export async function enableDailyCheckin(
  userId: string,
  projectId: string,
  opts: { url?: string | null; timeHint?: string | null } = {},
): Promise<void> {
  await getTrackedProject(userId, projectId); // 404 if not owned

  await getDb()
    .update(trackedProjects)
    .set({
      hasDailyCheckin: true,
      dailyCheckinUrl: opts.url ?? null,
      dailyCheckinTimeHint: opts.timeHint ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(trackedProjects.id, projectId), eq(trackedProjects.userId, userId)));
}

export async function disableDailyCheckin(userId: string, projectId: string): Promise<void> {
  await getTrackedProject(userId, projectId);
  await getDb()
    .update(trackedProjects)
    .set({
      hasDailyCheckin: false,
      dailyCheckinUrl: null,
      dailyCheckinTimeHint: null,
      updatedAt: new Date(),
    })
    .where(and(eq(trackedProjects.id, projectId), eq(trackedProjects.userId, userId)));
}

// ─── Log a completed check-in ────────────────────────────────────────────

export async function markCheckinDone(
  userId: string,
  projectId: string,
  opts: { notes?: string | null; source?: 'web' | 'telegram' | 'ai' } = {},
): Promise<{ streakDays: number }> {
  const project = await getTrackedProject(userId, projectId);
  if (!project.hasDailyCheckin) {
    throw new ValidationError('This project does not have daily check-in enabled.');
  }

  await getDb().insert(wlCheckinLog).values({
    projectId,
    userId,
    notes: opts.notes ?? null,
    source: opts.source ?? 'web',
  });

  const streak = await computeStreak(projectId);
  return { streakDays: streak };
}

// ─── Streak computation ──────────────────────────────────────────────────
// A streak = number of consecutive calendar days (in UTC) up to and
// including "today" that contain at least one check-in row. This runs
// entirely in Postgres so it stays fast even at thousands of log rows.
async function computeStreak(projectId: string): Promise<number> {
  const result = await getDb().execute<{ streak: number }>(sql`
    WITH days AS (
      SELECT DISTINCT (done_at AT TIME ZONE 'UTC')::date AS d
      FROM wl_checkin_log
      WHERE project_id = ${projectId}
    ),
    ranked AS (
      SELECT d, row_number() OVER (ORDER BY d DESC) - 1 AS rn
      FROM days
    )
    SELECT COUNT(*)::int AS streak
    FROM ranked
    WHERE d = (CURRENT_DATE AT TIME ZONE 'UTC')::date - rn
  `);
  // Neon HTTP driver returns { rows, rowCount, ... } instead of a plain array,
  // and TS can't figure that out from the generic. Cast defensively.
  const row = (result as unknown as { rows?: { streak: number }[] }).rows?.[0]
    ?? (Array.isArray(result) ? result[0] : undefined);
  return Number(row?.streak ?? 0);
}

// ─── Today's pending check-ins ───────────────────────────────────────────
// A project is "pending" today if:
//   - has_daily_checkin = true
//   - is_active = true
//   - archived_at IS NULL
//   - MAX(wl_checkin_log.done_at) < start-of-today in the user's timezone
//     (or no log rows exist at all)
//
// timezoneOverride defaults to 'UTC'. The Telegram digest passes each user's
// stored Asia/Calcutta etc.
export async function listPendingCheckins(
  userId: string,
  timezone: string = 'UTC',
): Promise<CheckinPending[]> {
  // Postgres validates the tz string — invalid names raise a warning and
  // silently fall back to UTC. Guard against SQL injection by rejecting
  // any non-standard-looking value.
  const safeTz = /^[A-Za-z_/+\-0-9]+$/.test(timezone) ? timezone : 'UTC';

  const queryResult = await getDb().execute<{
    project_id: string;
    project_name: string;
    twitter_handle: string;
    project_avatar_url: string | null;
    daily_checkin_url: string | null;
    daily_checkin_time_hint: string | null;
    last_done_at: Date | null;
  }>(sql`
    SELECT
      p.id                            AS project_id,
      p.project_name                  AS project_name,
      p.twitter_handle                AS twitter_handle,
      p.project_avatar_url            AS project_avatar_url,
      p.daily_checkin_url             AS daily_checkin_url,
      p.daily_checkin_time_hint       AS daily_checkin_time_hint,
      (SELECT MAX(done_at) FROM wl_checkin_log
        WHERE project_id = p.id)      AS last_done_at
    FROM tracked_projects p
    WHERE p.user_id            = ${userId}
      AND p.has_daily_checkin  = true
      AND p.is_active          = true
      AND p.archived_at IS NULL
      AND (
        NOT EXISTS (
          SELECT 1 FROM wl_checkin_log
          WHERE project_id = p.id
            AND (done_at AT TIME ZONE ${safeTz})::date
                = (NOW() AT TIME ZONE ${safeTz})::date
        )
      )
    ORDER BY p.project_name ASC
  `);

  // Neon HTTP driver wraps rows in { rows: [] }; the serverless driver returns
  // a plain array. Handle both without importing the driver types.
  type RowShape = {
    project_id: string;
    project_name: string;
    twitter_handle: string;
    project_avatar_url: string | null;
    daily_checkin_url: string | null;
    daily_checkin_time_hint: string | null;
    last_done_at: Date | null;
  };
  const rows: RowShape[] = (queryResult as unknown as { rows?: RowShape[] }).rows
    ?? (Array.isArray(queryResult) ? (queryResult as RowShape[]) : []);

  // Compute streak per pending project. This is O(N) log-table scans and
  // fine at typical volumes (< 300 projects).
  const result: CheckinPending[] = [];
  for (const r of rows) {
    const streak = await computeStreak(r.project_id);
    result.push({
      projectId: r.project_id,
      projectName: r.project_name,
      twitterHandle: r.twitter_handle,
      projectAvatarUrl: r.project_avatar_url,
      dailyCheckinUrl: r.daily_checkin_url,
      dailyCheckinTimeHint: r.daily_checkin_time_hint,
      lastDoneAt: r.last_done_at,
      streakDays: streak,
    });
  }
  return result;
}

// ─── Projects with daily check-in enabled (regardless of today's state) ──
export async function listAllCheckinProjects(userId: string) {
  return getDb()
    .select({
      id: trackedProjects.id,
      projectName: trackedProjects.projectName,
      twitterHandle: trackedProjects.twitterHandle,
      dailyCheckinUrl: trackedProjects.dailyCheckinUrl,
      dailyCheckinTimeHint: trackedProjects.dailyCheckinTimeHint,
    })
    .from(trackedProjects)
    .where(and(
      eq(trackedProjects.userId, userId),
      eq(trackedProjects.hasDailyCheckin, true),
      isNotNull(trackedProjects.userId), // no-op — placeholder for future filters
    ))
    .orderBy(desc(trackedProjects.updatedAt));
}

// ─── Look up a project by fuzzy handle (used by AI / Telegram) ───────────
// The AI often receives "pudgy" instead of "@pudgypenguins" — this helper
// resolves against twitter_handle and project_name so slash-command-less
// input still works.
export async function findProjectByFuzzyHandle(
  userId: string,
  needle: string,
): Promise<{ id: string; projectName: string; twitterHandle: string } | null> {
  const clean = needle.trim().replace(/^@+/, '').toLowerCase();
  if (!clean) return null;

  const [row] = await getDb()
    .select({
      id: trackedProjects.id,
      projectName: trackedProjects.projectName,
      twitterHandle: trackedProjects.twitterHandle,
    })
    .from(trackedProjects)
    .where(and(
      eq(trackedProjects.userId, userId),
      sql`(
        lower(twitter_handle) = ${'@' + clean}
        OR lower(twitter_handle) LIKE ${'%' + clean + '%'}
        OR lower(project_name)  LIKE ${'%' + clean + '%'}
      )`,
      sql`archived_at IS NULL`,
    ))
    .limit(1);

  return row ?? null;
}

// ─── Streak for a single project (public) ────────────────────────────────
export async function getStreak(userId: string, projectId: string): Promise<number> {
  // Ownership check — throws NotFoundError if the user doesn't own it.
  await getTrackedProject(userId, projectId);
  return computeStreak(projectId);
}
