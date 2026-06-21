ALTER TABLE "analyzer_history"
DROP COLUMN IF EXISTS "risk_summary";

ALTER TABLE "analyzer_history"
ADD COLUMN IF NOT EXISTS "floor_currency" text;

ALTER TABLE "analyzer_history"
ADD COLUMN IF NOT EXISTS "floor_symbol" text;
