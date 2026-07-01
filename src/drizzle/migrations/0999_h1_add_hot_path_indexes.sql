-- H-1 fix: add indexes to hot-path tables to eliminate full table scans
-- Safe to run multiple times (IF NOT EXISTS).
-- Uses CONCURRENTLY so it does not block writes during index creation.
--
-- mintHistory — hit on every dashboard load (7-day chart, Analytics, History tab)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_mint_history_user_created"
  ON "mint_history" ("user_id", "created_at" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_mint_history_status"
  ON "mint_history" ("status");

-- activities — notification bell fetches these on every page
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_activities_user_created"
  ON "activities" ("user_id", "created_at" DESC);

-- task_logs — task console polls every 2s while task active
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_task_logs_task_created"
  ON "task_logs" ("task_id", "created_at" ASC);
