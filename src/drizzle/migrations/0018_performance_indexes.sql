-- Migration: 0018_performance_indexes
-- Adds missing performance indexes identified in audit.
--
-- P-1: mint_tasks(user_id, status) — most common query pattern was doing full table scans.
-- P-2: analyzer_history(user_id, created_at) — userId queries had no index.
-- P-3: activities(user_id) — every activity feed query was scanning the full table.

CREATE INDEX IF NOT EXISTS "idx_mint_tasks_user_status"
  ON "mint_tasks" USING btree ("user_id", "status");

CREATE INDEX IF NOT EXISTS "idx_analyzer_history_user_created"
  ON "analyzer_history" USING btree ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_activities_user_id"
  ON "activities" USING btree ("user_id");
