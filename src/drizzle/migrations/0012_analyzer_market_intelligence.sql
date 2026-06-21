ALTER TABLE "analyzer_history"
ADD COLUMN "floor_price" text,
ADD COLUMN "owner_count" integer,
ADD COLUMN "volume" text,
ADD COLUMN "market_status" text,
ADD COLUMN "health_score" integer;
