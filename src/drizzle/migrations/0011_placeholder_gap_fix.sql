-- H-2 fix: placeholder for missing migration 0011
-- Migration 0011 was absent from the migrations directory, creating a gap
-- between 0010_analyzer_history and 0012_analyzer_market_intelligence.
-- This no-op migration closes the numbering gap so drizzle-kit migrate
-- applies migrations in correct sequential order on fresh deployments.
-- No schema changes are made here; 0012 contains the actual additions.

SELECT 1; -- no-op
