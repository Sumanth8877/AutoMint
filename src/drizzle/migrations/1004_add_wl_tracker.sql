-- ─── WL Tracker migration ────────────────────────────────────────────────
-- Adds two tables and three enum types for the whitelist / allowlist Twitter
-- watcher. Idempotent so it's safe to re-run against a db that may already
-- have some of these objects (e.g. drizzle push in dev, then formal migration
-- in prod).

-- ── Enums ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "wl_tweet_category" AS ENUM (
    'winners_announcement',
    'mint_link',
    'mint_reminder',
    'delay_postpone',
    'general_hype',
    'unrelated'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "wl_tweet_urgency" AS ENUM ('critical', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "wl_form_type" AS ENUM (
    'premint', 'alphabot', 'atlas3', 'superful',
    'gleam', 'google_form', 'twitter_form', 'discord', 'other'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── tracked_projects ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tracked_projects" (
  "id"                          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                     uuid           NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "twitter_handle"              text           NOT NULL,
  "twitter_user_id"             text,
  "project_name"                text           NOT NULL,
  "project_avatar_url"          text,
  "wallet_used"                 text,
  "form_type"                   "wl_form_type" DEFAULT 'other',
  "form_url"                    text,
  "notes"                       text,
  "expected_mint_date"          timestamp,
  "wl_announcement_hint"        timestamp,
  "is_active"                   boolean        NOT NULL DEFAULT true,
  "last_checked_at"             timestamp,
  "last_tweet_id_seen"          text,
  "poll_frequency_minutes"      integer        NOT NULL DEFAULT 15,
  "consecutive_empty_checks"    integer        NOT NULL DEFAULT 0,
  "consecutive_errors"          integer        NOT NULL DEFAULT 0,
  "archived_at"                 timestamp,
  "created_at"                  timestamp      NOT NULL DEFAULT now(),
  "updated_at"                  timestamp      NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_tracked_projects_user_active"
  ON "tracked_projects" ("user_id", "is_active");
CREATE INDEX IF NOT EXISTS "idx_tracked_projects_due_for_check"
  ON "tracked_projects" ("is_active", "last_checked_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tracked_projects_user_handle"
  ON "tracked_projects" ("user_id", "twitter_handle");

-- ── tracked_tweets ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tracked_tweets" (
  "id"                    uuid                 PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id"            uuid                 NOT NULL REFERENCES "tracked_projects"("id") ON DELETE CASCADE,
  "user_id"               uuid                 NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "tweet_id"              text                 NOT NULL,
  "tweet_url"             text                 NOT NULL,
  "tweet_text"            text                 NOT NULL,
  "posted_at"             timestamp            NOT NULL,
  "author_handle"         text                 NOT NULL,
  "category"              "wl_tweet_category"  NOT NULL,
  "urgency"               "wl_tweet_urgency"   NOT NULL,
  "ai_summary"            text,
  "extracted_mint_url"    text,
  "wallet_matched"        boolean              NOT NULL DEFAULT false,
  "raw_classification"    jsonb,
  "notified_at"           timestamp,
  "user_marked_as_read"   boolean              NOT NULL DEFAULT false,
  "user_marked_as_winner" boolean              NOT NULL DEFAULT false,
  "created_at"            timestamp            NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tracked_tweets_project_tweet"
  ON "tracked_tweets" ("project_id", "tweet_id");
CREATE INDEX IF NOT EXISTS "idx_tracked_tweets_user_posted"
  ON "tracked_tweets" ("user_id", "posted_at");
CREATE INDEX IF NOT EXISTS "idx_tracked_tweets_user_read"
  ON "tracked_tweets" ("user_id", "user_marked_as_read");
