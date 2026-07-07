-- ─── WL Tracker: daily check-in extension ────────────────────────────────
-- Adds the daily check-in feature on top of the WL Tracker (migration 1004).
-- Idempotent — safe to re-run.

-- ── New columns on tracked_projects ──────────────────────────────────────
ALTER TABLE "tracked_projects"
  ADD COLUMN IF NOT EXISTS "has_daily_checkin"      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "daily_checkin_url"      text,
  ADD COLUMN IF NOT EXISTS "daily_checkin_time_hint" text;

-- Hot-path index for the daily digest cron.
CREATE INDEX IF NOT EXISTS "idx_tracked_projects_user_checkin"
  ON "tracked_projects" ("user_id", "has_daily_checkin");

-- ── wl_checkin_log ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wl_checkin_log" (
  "id"         uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" uuid      NOT NULL REFERENCES "tracked_projects"("id") ON DELETE CASCADE,
  "user_id"    uuid      NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "done_at"    timestamp NOT NULL DEFAULT now(),
  "notes"      text,
  "source"     text      DEFAULT 'web',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_wl_checkin_log_project_done"
  ON "wl_checkin_log" ("project_id", "done_at");
CREATE INDEX IF NOT EXISTS "idx_wl_checkin_log_user_done"
  ON "wl_checkin_log" ("user_id", "done_at");
