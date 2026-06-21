ALTER TABLE "analyzer_history"
ADD COLUMN IF NOT EXISTS "floor_price" text,
ADD COLUMN IF NOT EXISTS "owner_count" integer,
ADD COLUMN IF NOT EXISTS "volume" text,
ADD COLUMN IF NOT EXISTS "market_status" text,
ADD COLUMN IF NOT EXISTS "health_score" integer;
