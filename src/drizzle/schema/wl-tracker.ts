import { pgTable, text, timestamp, uuid, integer, jsonb, pgEnum, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './index';

// ─── Enums ───────────────────────────────────────────────────────────────
export const wlTweetCategoryEnum = pgEnum('wl_tweet_category', [
  'winners_announcement',
  'mint_link',
  'mint_reminder',
  'delay_postpone',
  'general_hype',
  'unrelated',
]);

export const wlTweetUrgencyEnum = pgEnum('wl_tweet_urgency', [
  'critical', // winner announced / mint live NOW → wake user
  'high',     // mint link / mint in <1h
  'medium',   // reminders / delays
  'low',      // hype / info
]);

export const wlFormTypeEnum = pgEnum('wl_form_type', [
  'premint',
  'alphabot',
  'atlas3',
  'superful',
  'gleam',
  'google_form',
  'twitter_form',
  'discord',
  'other',
]);

// ─── Tracked Projects ────────────────────────────────────────────────────
// One row = one project the user is actively watching for updates on Twitter.
// After manually filling a WL form, the user runs `/track @handle` to have
// the system watch that account and surface any winner/mint/delay tweets.
export const trackedProjects = pgTable('tracked_projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

  // ─ What we're tracking ─────────────────────────────────────────────────
  twitterHandle: text('twitter_handle').notNull(),           // '@pudgypenguins' (normalized, lowercase, with @)
  twitterUserId: text('twitter_user_id'),                    // resolved once via socialdata.tools, cached forever
  projectName: text('project_name').notNull(),               // display name — fetched from Twitter profile
  projectAvatarUrl: text('project_avatar_url'),

  // ─ User context (why did I add this?) ──────────────────────────────────
  walletUsed: text('wallet_used'),                           // "the wallet I applied with" (0x…)
  formType: wlFormTypeEnum('form_type').default('other'),
  formUrl: text('form_url'),                                 // link back to the form I filled (optional)
  notes: text('notes'),                                      // "did rt+follow+comment"

  // ─ Timing hints (user-supplied or AI-parsed) ───────────────────────────
  expectedMintDate: timestamp('expected_mint_date'),
  wlAnnouncementHint: timestamp('wl_announcement_hint'),     // "winners announced Fri 5pm UTC"

  // ─ Watcher state ───────────────────────────────────────────────────────
  isActive: boolean('is_active').default(true).notNull(),
  lastCheckedAt: timestamp('last_checked_at'),
  lastTweetIdSeen: text('last_tweet_id_seen'),               // socialdata cursor / largest id_str seen
  pollFrequencyMinutes: integer('poll_frequency_minutes').default(15).notNull(),
  consecutiveEmptyChecks: integer('consecutive_empty_checks').default(0).notNull(), // backs off polling
  consecutiveErrors: integer('consecutive_errors').default(0).notNull(),            // pauses on 5+

  // ─ Lifecycle ───────────────────────────────────────────────────────────
  archivedAt: timestamp('archived_at'),                      // user marked done or too old
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Hot path: watcher cron picks projects due for a check.
  userActiveIdx: index('idx_tracked_projects_user_active').on(table.userId, table.isActive),
  dueForCheckIdx: index('idx_tracked_projects_due_for_check')
    .on(table.isActive, table.lastCheckedAt),
  // Prevent a user from tracking the same handle twice.
  userHandleIdx: uniqueIndex('idx_tracked_projects_user_handle')
    .on(table.userId, table.twitterHandle),
}));

// ─── Tracked Tweets ──────────────────────────────────────────────────────
// One row per tweet the classifier has surfaced (i.e. category != 'unrelated').
// The full unfiltered stream is NOT stored — only the interesting ones.
export const trackedTweets = pgTable('tracked_tweets', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => trackedProjects.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),

  // ─ Raw tweet payload ───────────────────────────────────────────────────
  tweetId: text('tweet_id').notNull(),                       // Twitter's id_str
  tweetUrl: text('tweet_url').notNull(),
  tweetText: text('tweet_text').notNull(),
  postedAt: timestamp('posted_at').notNull(),
  authorHandle: text('author_handle').notNull(),

  // ─ AI classification result ────────────────────────────────────────────
  category: wlTweetCategoryEnum('category').notNull(),
  urgency: wlTweetUrgencyEnum('urgency').notNull(),
  aiSummary: text('ai_summary'),
  extractedMintUrl: text('extracted_mint_url'),
  walletMatched: boolean('wallet_matched').default(false).notNull(), // tweet contained one of user's wallets
  rawClassification: jsonb('raw_classification'),            // full JSON returned by classifier

  // ─ Notification tracking ───────────────────────────────────────────────
  notifiedAt: timestamp('notified_at'),                      // when Telegram/email sent
  userMarkedAsRead: boolean('user_marked_as_read').default(false).notNull(),
  userMarkedAsWinner: boolean('user_marked_as_winner').default(false).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // De-dupe: never store the same tweet twice for a project.
  projectTweetIdx: uniqueIndex('idx_tracked_tweets_project_tweet').on(table.projectId, table.tweetId),
  // Feed queries: user timeline sorted by posted_at DESC.
  userPostedIdx: index('idx_tracked_tweets_user_posted').on(table.userId, table.postedAt),
  // Unread badge count.
  userReadIdx: index('idx_tracked_tweets_user_read').on(table.userId, table.userMarkedAsRead),
}));

// ─── Relations ───────────────────────────────────────────────────────────
export const trackedProjectsRelations = relations(trackedProjects, ({ one, many }) => ({
  user: one(users, { fields: [trackedProjects.userId], references: [users.id] }),
  tweets: many(trackedTweets),
}));

export const trackedTweetsRelations = relations(trackedTweets, ({ one }) => ({
  project: one(trackedProjects, { fields: [trackedTweets.projectId], references: [trackedProjects.id] }),
  user: one(users, { fields: [trackedTweets.userId], references: [users.id] }),
}));
