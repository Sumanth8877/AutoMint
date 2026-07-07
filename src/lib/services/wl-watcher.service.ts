import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trackedProjects, trackedTweets, wallets } from '@/drizzle/schema';
// NOTE: `wallets` is re-exported from '@/drizzle/schema' (index.ts) — used
// here to check if a tweet mentions one of the user's saved wallet addresses.
import {
  getUserTweets,
  extractFirstUrl,
  TwitterProviderError,
  type TwitterTweet,
} from '@/lib/services/twitter.provider';
import { classifyTweet, type WlClassification } from '@/lib/services/wl-tweet-classifier.service';
import { notifyWlTweet } from '@/lib/services/wl-notifier.service';
import { logger } from '@/lib/logger';
import type { TrackedProject } from '@/lib/services/wl-tracker.service';

// ─── Watcher: check ONE project ──────────────────────────────────────────
//
// For a single tracked project:
//   1. Fetch tweets since `lastTweetIdSeen` via socialdata.tools.
//   2. For each new tweet, run the AI classifier.
//   3. Persist tweets whose category is NOT 'unrelated'.
//   4. Send a Telegram notification for anything urgency ∈ {critical, high, medium}.
//   5. Update the project's cursor + polling stats (adaptive backoff).
//
// This function is called by the QStash worker endpoint — one HTTP request
// per project per check. Failures are recorded on the project row so that
// after 5 consecutive errors the project is auto-paused (see the
// `consecutive_errors < 5` filter in selectProjectsDueForCheck).

export type WatcherRunResult = {
  projectId: string;
  handle: string;
  newTweetsSeen: number;
  tweetsPersisted: number;
  notificationsSent: number;
  status: 'ok' | 'no_new' | 'error';
  errorMessage?: string;
};

export async function checkProject(project: TrackedProject): Promise<WatcherRunResult> {
  const runResult: WatcherRunResult = {
    projectId: project.id,
    handle: project.twitterHandle,
    newTweetsSeen: 0,
    tweetsPersisted: 0,
    notificationsSent: 0,
    status: 'ok',
  };

  if (!project.twitterUserId) {
    // Should never happen — the ID is resolved at add time — but guard anyway.
    await recordCheckError(project.id, 'Missing twitter_user_id');
    return { ...runResult, status: 'error', errorMessage: 'Missing twitter_user_id' };
  }

  // 1. Fetch new tweets.
  let tweets: TwitterTweet[];
  try {
    tweets = await getUserTweets(project.twitterUserId, {
      sinceId: project.lastTweetIdSeen,
    });
  } catch (error) {
    const message = error instanceof TwitterProviderError
      ? `Twitter provider: ${error.message}`
      : (error as Error).message;
    await recordCheckError(project.id, message);
    return { ...runResult, status: 'error', errorMessage: message };
  }

  runResult.newTweetsSeen = tweets.length;

  if (tweets.length === 0) {
    await recordEmptyCheck(project.id);
    return { ...runResult, status: 'no_new' };
  }

  // 2. Load the user's wallets once so wallet-in-tweet detection is O(N).
  const userWalletAddresses = await getUserWalletAddresses(project.userId);

  // 3. Classify + persist newest-last so cursor advances monotonically.
  //    (SocialData returns newest-first; reverse for processing order.)
  const sortedOldToNew = [...tweets].reverse();
  let newHighestId = project.lastTweetIdSeen;

  for (const tweet of sortedOldToNew) {
    // Skip retweets by default — they usually rebroadcast old news.
    if (tweet.is_retweet) {
      newHighestId = maxId(newHighestId, tweet.id_str);
      continue;
    }

    let classification: WlClassification;
    try {
      classification = await classifyTweet({
        projectName: project.projectName,
        projectHandle: project.twitterHandle,
        tweetText: tweet.full_text ?? '',
        postedAt: parseTwitterDate(tweet.created_at),
      });
    } catch (error) {
      // Classifier already has its own safe fallback, but wrap defensively.
      logger.warn('WL watcher: classifier threw', {
        area: 'wl-watcher',
        projectId: project.id,
        tweetId: tweet.id_str,
        error: (error as Error).message,
      });
      newHighestId = maxId(newHighestId, tweet.id_str);
      continue;
    }

    // Skip 'unrelated' — don't spam the DB or the user's feed.
    if (classification.category === 'unrelated') {
      newHighestId = maxId(newHighestId, tweet.id_str);
      continue;
    }

    const walletMatched = detectWalletInTweet(tweet.full_text ?? '', userWalletAddresses);

    const postedAt = parseTwitterDate(tweet.created_at);
    const tweetUrl = `https://x.com/${tweet.user.screen_name}/status/${tweet.id_str}`;
    const extractedMintUrl = classification.mint_url ?? extractFirstUrl(tweet);

    // De-dupe safe: unique(project_id, tweet_id).
    const [inserted] = await getDb()
      .insert(trackedTweets)
      .values({
        projectId: project.id,
        userId: project.userId,
        tweetId: tweet.id_str,
        tweetUrl,
        tweetText: tweet.full_text ?? '',
        postedAt,
        authorHandle: `@${tweet.user.screen_name}`,
        category: classification.category,
        urgency: classification.urgency,
        aiSummary: classification.summary,
        extractedMintUrl: extractedMintUrl ?? null,
        walletMatched,
        rawClassification: classification as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: [trackedTweets.projectId, trackedTweets.tweetId] })
      .returning();

    if (inserted) {
      runResult.tweetsPersisted += 1;

      // 4. Notify user for anything not low-urgency.
      //    Wallet-matched tweets are always escalated to at least 'high'.
      const shouldNotify = walletMatched || classification.urgency !== 'low';
      if (shouldNotify) {
        try {
          await notifyWlTweet({
            userId: project.userId,
            project,
            tweet: inserted,
          });
          runResult.notificationsSent += 1;
        } catch (error) {
          logger.warn('WL watcher: notification send failed', {
            area: 'wl-watcher',
            projectId: project.id,
            tweetId: tweet.id_str,
            error: (error as Error).message,
          });
        }
      }
    }

    newHighestId = maxId(newHighestId, tweet.id_str);
  }

  // 5. Update cursor + reset error counters + adaptive polling backoff.
  await getDb()
    .update(trackedProjects)
    .set({
      lastTweetIdSeen: newHighestId,
      lastCheckedAt: new Date(),
      consecutiveEmptyChecks: 0,
      consecutiveErrors: 0,
      pollFrequencyMinutes: pickPollFrequency(project, /* hadNewTweets */ true),
      updatedAt: new Date(),
    })
    .where(eq(trackedProjects.id, project.id));

  return runResult;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getUserWalletAddresses(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ address: wallets.address })
    .from(wallets)
    .where(eq(wallets.userId, userId));
  return rows.map((r) => r.address.toLowerCase());
}

/**
 * True if the tweet text contains any of the user's wallet addresses.
 * Case-insensitive; matches on the full 0x… hex string.
 */
function detectWalletInTweet(text: string, walletAddresses: string[]): boolean {
  if (walletAddresses.length === 0) return false;
  const lower = text.toLowerCase();
  return walletAddresses.some((addr) => lower.includes(addr));
}

/**
 * Parse Twitter's "Mon Dec 05 12:34:56 +0000 2024" date format into a Date.
 * Node's Date constructor accepts this natively.
 */
function parseTwitterDate(raw: string): Date {
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Return whichever id_str represents a newer tweet.
 * See bigIntGt in twitter.provider.ts for the string-length trick.
 */
function maxId(a: string | null, b: string): string {
  if (!a) return b;
  if (a.length !== b.length) return a.length > b.length ? a : b;
  return a > b ? a : b;
}

/**
 * Adaptive poll frequency:
 *   - Mint within 24h                    →  5 min
 *   - Mint within 7 days                 → 15 min
 *   - No mint date, active feed          → user's default (15 min)
 *   - No mint date, quiet feed (3+ empty checks) → 60 min
 */
function pickPollFrequency(project: TrackedProject, hadNewTweets: boolean): number {
  const now = Date.now();
  const mintDate = project.expectedMintDate ? new Date(project.expectedMintDate).getTime() : null;

  if (mintDate !== null) {
    const hoursUntilMint = (mintDate - now) / (1000 * 60 * 60);
    if (hoursUntilMint <= 24 && hoursUntilMint >= -4) return 5;
    if (hoursUntilMint <= 24 * 7 && hoursUntilMint >= -24) return 15;
  }

  if (hadNewTweets) return Math.min(project.pollFrequencyMinutes, 15);
  return project.pollFrequencyMinutes;
}

async function recordEmptyCheck(projectId: string): Promise<void> {
  await getDb()
    .update(trackedProjects)
    .set({
      lastCheckedAt: new Date(),
      consecutiveEmptyChecks: sql`${trackedProjects.consecutiveEmptyChecks} + 1`,
      consecutiveErrors: 0,
      // After 3 consecutive empty checks and no mint date, back off to 60 min.
      pollFrequencyMinutes: sql`
        CASE
          WHEN expected_mint_date IS NULL AND ${trackedProjects.consecutiveEmptyChecks} + 1 >= 3
            THEN LEAST(60, GREATEST(poll_frequency_minutes, 30))
          ELSE poll_frequency_minutes
        END
      `,
      updatedAt: new Date(),
    })
    .where(eq(trackedProjects.id, projectId));
}

async function recordCheckError(projectId: string, message: string): Promise<void> {
  logger.warn('WL watcher: check failed', { area: 'wl-watcher', projectId, message });
  await getDb()
    .update(trackedProjects)
    .set({
      lastCheckedAt: new Date(),
      consecutiveErrors: sql`${trackedProjects.consecutiveErrors} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(trackedProjects.id, projectId));
}

// ─── Cron entry point ────────────────────────────────────────────────────
// Called by /api/webhooks/qstash/wl-cron every N minutes. Grabs the next
// batch of due-for-check projects and dispatches them concurrently (bounded).

const CRON_CONCURRENCY = 5;
const CRON_BATCH_SIZE = 30;

export async function runWatcherCron(): Promise<WatcherRunResult[]> {
  const { selectProjectsDueForCheck } = await import('@/lib/services/wl-tracker.service');
  const due = await selectProjectsDueForCheck(CRON_BATCH_SIZE);
  if (due.length === 0) return [];

  logger.info('WL watcher cron: dispatching batch', {
    area: 'wl-watcher',
    count: due.length,
  });

  const results: WatcherRunResult[] = [];
  for (let i = 0; i < due.length; i += CRON_CONCURRENCY) {
    const slice = due.slice(i, i + CRON_CONCURRENCY);
    const settled = await Promise.allSettled(slice.map(checkProject));
    for (const [idx, r] of settled.entries()) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        const project = slice[idx];
        results.push({
          projectId: project.id,
          handle: project.twitterHandle,
          newTweetsSeen: 0,
          tweetsPersisted: 0,
          notificationsSent: 0,
          status: 'error',
          errorMessage: (r.reason as Error)?.message ?? 'unknown',
        });
      }
    }
  }
  return results;
}
