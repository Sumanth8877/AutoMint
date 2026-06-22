-- Migration: 0015_mint_history_idempotency_key
--
-- Adds idempotency_key to mint_history for fast-path deduplication.
--
-- Background:
--   mint-fast.service.ts previously stored an idempotency key in the
--   transactionHash column and queried it back with WHERE transactionHash = key.
--   transactionHash stores real on-chain hashes (0x...) so the key
--   ("fast_mint:uuid:0xContract:chain") never matched — the check was silently broken.
--
-- Fix:
--   A dedicated nullable column with UNIQUE constraint so that:
--     INSERT ... idempotency_key = 'fast_mint:...' fails on duplicate
--     SELECT WHERE idempotency_key = ... returns the original record
--
-- The column is nullable to preserve all existing rows without backfill.
-- Only fast-path executions populate it; scheduled mints leave it NULL.

ALTER TABLE mint_history ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS mint_history_idempotency_key_unique
  ON mint_history (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
