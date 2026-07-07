import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trackedProjects, trackedTweets } from '@/drizzle/schema/wl-tracker';
import {
  getUserByScreenName,
  getUserTweets,
  normalizeHandle,
  TwitterProviderError,
} from '@/lib/services/twitter.provider';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

// ─── Public shapes ───────────────────────────────────────────────────────

export type TrackedProject = typeof trackedProjects.$inferSelect;
export type TrackedTweet = typeof trackedTweets.$inferSelect;

export type AddTrackedProjectInput = {
  handle: string;                                // any format — normalized here
  walletUsed?: string | null;
  formType?: typeof trackedProjects.$inferInsert['formType'];
  formUrl?: string | null;
  notes?: string | null;
  expectedMintDate?: Date | null;
  wlAnnouncementHint?: Date | null;
  pollFrequencyMinutes?: number;
  hasDailyCheckin?: boolean;
  dailyCheckinUrl?: string | null;
  dailyCheckinTimeHint?: string | null;
};

// ─── Add ─────────────────────────────────────────────────────────────────
// Resolves the Twitter profile once (cached forever in twitterUserId) and
// baselines the tweet cursor so we don't spam the user with old tweets.
export async function addTrackedProject(
  userId: string,
  input: AddTrackedProjectInput,
): Promise<TrackedProject> {
  const normalized = normalizeHandle(input.handle);
  if (!normalized || !/^[a-z0-9_]{1,20}$/i.test(normalized)) {
    throw new ValidationError(`Invalid Twitter handle: ${input.handle}`);
  }

  const handleWithAt = `@${normalized}`;

  // Reject duplicates early with a friendly error.
  const [existing] = await getDb()
    .select()
    .from(trackedProjects)
    .where(and(
      eq(trackedProjects.userId, userId),
      eq(trackedProjects.twitterHandle, handleWithAt),
    ))
    .limit(1);

  if (existing) {
    throw new ConflictError(`Already tracking ${handleWithAt}`, 'ALREADY_TRACKED');
  }

  // Resolve the profile. If SOCIALDATA_API_KEY is missing this throws with
  // a clear message the API layer surfaces to the user.
  let profile;
  try {
    profile = await getUserByScreenName(normalized);
  } catch (error) {
    if (error instanceof TwitterProviderError) {
      // Surface provider errors as-is so the UI can show "connect your API
      // key" or "handle not found" without unwrapping.
      throw new AppError(error.message, error.status ?? 502, error.code);
    }
    throw error;
  }

  // Baseline: fetch the current top tweet id_str so future polls only surface
  // tweets posted AFTER the moment of tracking. If the fetch fails we still
  // create the row — the first watcher run will backfill the cursor.
  let baselineLastTweetId: string | null = null;
  try {
    const recent = await getUserTweets(profile.id_str);
    baselineLastTweetId = recent[0]?.id_str ?? null;
  } catch (error) {
    logger.warn('WL tracker: failed to baseline last_tweet_id_seen', {
      area: 'wl-tracker',
      handle: handleWithAt,
      error: (error as Error).message,
    });
  }

  const [row] = await getDb()
    .insert(trackedProjects)
    .values({
      userId,
      twitterHandle: handleWithAt,
      twitterUserId: profile.id_str,
      projectName: profile.name || normalized,
      projectAvatarUrl: profile.profile_image_url_https ?? null,
      walletUsed: input.walletUsed ?? null,
      formType: input.formType ?? 'other',
      formUrl: input.formUrl ?? null,
      notes: input.notes ?? null,
      expectedMintDate: input.expectedMintDate ?? null,
      wlAnnouncementHint: input.wlAnnouncementHint ?? null,
      pollFrequencyMinutes: input.pollFrequencyMinutes ?? 15,
      hasDailyCheckin: input.hasDailyCheckin ?? false,
      dailyCheckinUrl: input.dailyCheckinUrl ?? null,
      dailyCheckinTimeHint: input.dailyCheckinTimeHint ?? null,
      lastTweetIdSeen: baselineLastTweetId,
      isActive: true,
    })
    .returning();

  return row;
}

// ─── List ────────────────────────────────────────────────────────────────

export async function listTrackedProjects(userId: string, opts: { includeArchived?: boolean } = {}) {
  const rows = await getDb()
    .select()
    .from(trackedProjects)
    .where(
      opts.includeArchived
        ? eq(trackedProjects.userId, userId)
        : and(eq(trackedProjects.userId, userId), sql`archived_at IS NULL`),
    )
    .orderBy(desc(trackedProjects.createdAt));
  return rows;
}

export async function getTrackedProject(userId: string, id: string): Promise<TrackedProject> {
  const [row] = await getDb()
    .select()
    .from(trackedProjects)
    .where(and(eq(trackedProjects.id, id), eq(trackedProjects.userId, userId)))
    .limit(1);
  if (!row) throw new NotFoundError('Tracked project not found');
  return row;
}

// ─── Update / archive / delete ───────────────────────────────────────────

export async function updateTrackedProject(
  userId: string,
  id: string,
  updates: Partial<Pick<TrackedProject,
    | 'walletUsed'
    | 'formType'
    | 'formUrl'
    | 'notes'
    | 'expectedMintDate'
    | 'wlAnnouncementHint'
    | 'pollFrequencyMinutes'
    | 'isActive'
  >>,
): Promise<TrackedProject> {
  await getTrackedProject(userId, id); // 404 if not owned

  const [row] = await getDb()
    .update(trackedProjects)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(trackedProjects.id, id), eq(trackedProjects.userId, userId)))
    .returning();
  return row;
}

export async function archiveTrackedProject(userId: string, id: string): Promise<void> {
  await getTrackedProject(userId, id);
  await getDb()
    .update(trackedProjects)
    .set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(and(eq(trackedProjects.id, id), eq(trackedProjects.userId, userId)));
}

export async function deleteTrackedProject(userId: string, id: string): Promise<void> {
  await getTrackedProject(userId, id);
  await getDb()
    .delete(trackedProjects)
    .where(and(eq(trackedProjects.id, id), eq(trackedProjects.userId, userId)));
}

// ─── Tweet feed ──────────────────────────────────────────────────────────

export async function listTweetsForUser(userId: string, opts: { limit?: number; unreadOnly?: boolean } = {}) {
  const limit = Math.min(opts.limit ?? 50, 200);
  const conditions = [eq(trackedTweets.userId, userId)];
  if (opts.unreadOnly) conditions.push(eq(trackedTweets.userMarkedAsRead, false));

  return getDb()
    .select()
    .from(trackedTweets)
    .where(and(...conditions))
    .orderBy(desc(trackedTweets.postedAt))
    .limit(limit);
}

export async function listTweetsForProject(userId: string, projectId: string, limit = 50) {
  await getTrackedProject(userId, projectId);
  return getDb()
    .select()
    .from(trackedTweets)
    .where(and(
      eq(trackedTweets.userId, userId),
      eq(trackedTweets.projectId, projectId),
    ))
    .orderBy(desc(trackedTweets.postedAt))
    .limit(Math.min(limit, 200));
}

export async function markTweetRead(userId: string, tweetId: string): Promise<void> {
  await getDb()
    .update(trackedTweets)
    .set({ userMarkedAsRead: true })
    .where(and(eq(trackedTweets.id, tweetId), eq(trackedTweets.userId, userId)));
}

export async function markTweetAsWinner(userId: string, tweetId: string): Promise<void> {
  await getDb()
    .update(trackedTweets)
    .set({ userMarkedAsWinner: true, userMarkedAsRead: true })
    .where(and(eq(trackedTweets.id, tweetId), eq(trackedTweets.userId, userId)));
}

// ─── Watcher-facing queries ──────────────────────────────────────────────
// These are used by the QStash cron dispatcher — never expose them to end
// users directly (no userId filter).

/**
 * Projects due for a Twitter check. Selects active, non-archived rows whose
 * last_checked_at is older than their pollFrequencyMinutes threshold (or
 * never checked). Ordered oldest-first so starved rows drain first.
 */
export async function selectProjectsDueForCheck(limit = 50) {
  return getDb()
    .select()
    .from(trackedProjects)
    .where(sql`
      is_active = true
      AND archived_at IS NULL
      AND consecutive_errors < 5
      AND (
        last_checked_at IS NULL
        OR last_checked_at < NOW() - (poll_frequency_minutes || ' minutes')::interval
      )
    `)
    .orderBy(sql`last_checked_at ASC NULLS FIRST`)
    .limit(limit);
}
