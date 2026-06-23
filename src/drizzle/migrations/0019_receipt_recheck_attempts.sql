-- Migration: 0019_receipt_recheck_attempts
-- Separates the receipt-recheck attempt counter from the mint-retry counter.
--
-- Problem: qstash.service.ts repurposed mintTasks.max_retries as both:
--   (a) the number of QStash-triggered mint retries remaining, AND
--   (b) the number of receipt-recheck attempts remaining.
-- This caused the two counters to interfere: a mint that went 'unconfirmed'
-- after spending some retries would have fewer receipt rechecks available,
-- and vice versa.
--
-- Fix: add a dedicated receipt_recheck_attempts column (default 10).
-- The qstash.service.ts receipt recheck path now reads/writes this column
-- exclusively. max_retries is restored to mint-retry use only.

ALTER TABLE mint_tasks
  ADD COLUMN IF NOT EXISTS receipt_recheck_attempts integer NOT NULL DEFAULT 10;

COMMENT ON COLUMN mint_tasks.receipt_recheck_attempts IS
  'Number of QStash receipt-recheck attempts remaining for this task. Decremented by executeReceiptRecheck. Independent of max_retries.';
