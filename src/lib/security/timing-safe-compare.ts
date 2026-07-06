import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';

// ── Constant-time string comparison (length-leak-free) ─────────────────────
//
// node:crypto's timingSafeEqual() throws if the two buffers have different
// lengths, which forces callers to length-check first — but that early
// length check is itself a timing side-channel: an attacker measuring
// response latency can distinguish "wrong length" (fails instantly) from
// "right length, wrong content" (fails after the constant-time compare),
// letting them binary-search the secret's length before attacking its
// content.
//
// Hashing both values to a fixed-length digest before comparing removes the
// length branch entirely: every comparison, regardless of input length,
// takes the same code path and (to a first approximation) the same time.
// ────────────────────────────────────────────────────────────────────────

/**
 * Compares two strings for equality without leaking timing information
 * about their length or where they first differ.
 */
export function secureCompare(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Convenience helper for the common "Authorization: Bearer <secret>" check
 * used across several routes (cron/webhook endpoints protected by a shared
 * secret env var).
 */
export function isAuthorizedBearer(authorizationHeader: string | null, expectedSecret: string): boolean {
  const provided = authorizationHeader ?? '';
  const expected = `Bearer ${expectedSecret}`;
  return secureCompare(provided, expected);
}
