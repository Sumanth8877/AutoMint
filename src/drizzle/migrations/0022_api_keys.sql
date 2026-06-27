-- Migration: 0022_api_keys
-- Adds the api_keys table for user-scoped API key management.
-- Replaces the single-env-var AUTOMINT_API_KEY approach.

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"     uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"        text NOT NULL,
  "prefix"      text NOT NULL,
  "hash"        text NOT NULL,
  "scopes"      jsonb NOT NULL DEFAULT '["*"]',
  "last_used_at" timestamp,
  "expires_at"  timestamp,
  "revoked_at"  timestamp,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "updated_at"  timestamp NOT NULL DEFAULT now()
);

-- Index: fast lookup by hash (used on every authenticated request)
CREATE UNIQUE INDEX "idx_api_keys_hash" ON "api_keys" ("hash");

-- Index: list keys by user
CREATE INDEX "idx_api_keys_user_id" ON "api_keys" ("user_id");

-- Index: prefix lookup (for key identification in logs / UI)
CREATE INDEX "idx_api_keys_prefix" ON "api_keys" ("prefix");
