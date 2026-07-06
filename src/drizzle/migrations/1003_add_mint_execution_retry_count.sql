-- Dedicated retry counter for failed on-chain mint execution attempts.
--
-- Previously, execution-failure retries reused `max_retries`, which is also
-- used as the "reschedule while waiting for mint to go live" counter — the
-- two purposes shared one column, which was confusing and made it impossible
-- to give execution retries different timing/count without affecting the
-- pre-live monitoring loop.
--
-- This column governs ONLY the execution-failure retry path (see
-- executeScheduledMint's "Retry on transient failure" block in
-- src/lib/services/qstash.service.ts): fixed at 5 attempts, 2 seconds apart.
ALTER TABLE mint_tasks
  ADD COLUMN IF NOT EXISTS execution_retries_remaining integer NOT NULL DEFAULT 5;
