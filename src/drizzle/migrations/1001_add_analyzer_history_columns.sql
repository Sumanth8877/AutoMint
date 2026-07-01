-- Migration: Add missing columns to analyzer_history
-- The analyzerHistory Drizzle schema was extended after the initial table creation.
-- This migration safely adds all new columns using IF NOT EXISTS guards.

ALTER TABLE "analyzer_history"
  ADD COLUMN IF NOT EXISTS "source_url"          text,
  ADD COLUMN IF NOT EXISTS "collection_name"     text,
  ADD COLUMN IF NOT EXISTS "contract_address"    text,
  ADD COLUMN IF NOT EXISTS "chain"               text NOT NULL DEFAULT 'ethereum',
  ADD COLUMN IF NOT EXISTS "risk_score"          integer,
  ADD COLUMN IF NOT EXISTS "risk_level"          text,
  ADD COLUMN IF NOT EXISTS "risk_factors"        jsonb,
  ADD COLUMN IF NOT EXISTS "floor_price"         text,
  ADD COLUMN IF NOT EXISTS "floor_currency"      text,
  ADD COLUMN IF NOT EXISTS "floor_symbol"        text,
  ADD COLUMN IF NOT EXISTS "owner_count"         integer,
  ADD COLUMN IF NOT EXISTS "volume"              text,
  ADD COLUMN IF NOT EXISTS "market_status"       text,
  ADD COLUMN IF NOT EXISTS "health_score"        integer,
  ADD COLUMN IF NOT EXISTS "opportunity_score"   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "readiness_score"     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mint_state"          text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "provider_used"       text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "cache_used"          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "rpc_provider_used"   text,
  ADD COLUMN IF NOT EXISTS "socials"             jsonb,
  ADD COLUMN IF NOT EXISTS "social_count"        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "analysis_duration_ms" integer NOT NULL DEFAULT 0;

-- Performance index: look up by user + date (most common query pattern)
CREATE INDEX IF NOT EXISTS "idx_analyzer_history_user_created"
  ON "analyzer_history" ("user_id", "created_at" DESC);
