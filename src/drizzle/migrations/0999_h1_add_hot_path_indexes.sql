-- H-1 fix: add indexes to hot-path tables to eliminate full table scans
-- Safe to run multiple times (IF NOT EXISTS).
--
-- NOTE: CONCURRENTLY removed — CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction block, and Drizzle Kit wraps migrations in transactions by
-- default. Standard CREATE INDEX IF NOT EXISTS is used instead. For a
-- production DB with millions of rows where you want zero write downtime,
-- run these manually via psql outside a transaction.
--
-- mintHistory — hit on every dashboard load (7-day chart, Analytics, History tab)
CREATE INDEX IF NOT EXISTS "idx_mint_history_user_created"
  ON "mint_history" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_mint_history_status"
  ON "mint_history" ("status");

-- activities — notification bell fetches these on every page
CREATE INDEX IF NOT EXISTS "idx_activities_user_created"
  ON "activities" ("user_id", "created_at" DESC);

-- task_logs — task console polls every 2s while task active
CREATE INDEX IF NOT EXISTS "idx_task_logs_task_created"
  ON "task_logs" ("task_id", "created_at" ASC);
