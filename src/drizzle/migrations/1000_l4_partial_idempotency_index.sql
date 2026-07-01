-- L-04 fix: convert the idempotency_key unique index into a PARTIAL unique index.
--
-- Problem: idempotency_key is nullable. A plain UNIQUE index in PostgreSQL treats
-- every NULL as distinct, so multiple tasks with idempotency_key = NULL were all
-- allowed — the index provided no protection for NULL-key rows and gave a false
-- sense of duplicate-prevention.
--
-- Fix: drop the full unique index and recreate it WHERE idempotency_key IS NOT NULL.
-- Uniqueness is now enforced only on rows that actually set a key; NULL-key rows
-- are unconstrained (as intended).

DROP INDEX IF EXISTS "idx_tasks_idempotency_key";

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tasks_idempotency_key"
  ON "tasks" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
