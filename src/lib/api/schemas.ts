/**
 * Shared Zod schemas for API route body validation.
 *
 * Using Zod replaces manual `if (!x || typeof x !== 'string')` checks
 * with a single `.parse()` call that returns typed data + helpful error messages.
 */
import { z } from 'zod';

// ── Shared primitives ────────────────────────────────────────────────────────

const urlString = z.string().min(1, 'URL is required').url('Must be a valid URL');
const uuidString = z.string().uuid('Must be a valid UUID');
const gasStrategy = z.enum(['STANDARD', 'FAST', 'AGGRESSIVE']);

// ── POST /api/mints ──────────────────────────────────────────────────────────
export const mintCreateSchema = z.object({
  walletId:          z.string().optional(),
  collectionId:      uuidString.optional(),
  mintUrl:           z.string().min(1).optional(),
  analysisConfirmed: z.boolean().optional(),
  quantity:          z.union([z.string(), z.number()]).optional(),
  safeModeEnabled:   z.boolean().optional(),
  gasStrategy:       gasStrategy.optional(),
  maxRetries:        z.number().int().min(0).max(100).optional(),
  riskThreshold:     z.number().int().min(0).max(100).optional(),
  scheduleTime:      z.string().optional(),
  /** true = skip public; check WL/AL/Free-mint eligibility + proof instead */
  wlMode:            z.boolean().optional().default(false),
});

export const mintActionSchema = z.object({
  id:     z.string().min(1, 'Task ID is required'),
  action: z.enum(['start', 'cancel']),
});

export const mintDeleteSchema = z.object({
  id: z.string().min(1, 'Task ID is required'),
});

// ── POST /api/instant-mint ───────────────────────────────────────────────────
export const instantMintSchema = z.object({
  url: urlString,
});

// ── POST /api/analyzer ───────────────────────────────────────────────────────
export const analyzerSchema = z.object({
  input:             z.string().min(1, 'Input is required'),
  stream:            z.boolean().optional(),
  skipCache:         z.boolean().optional(),
  autoDetectSocials: z.boolean().optional(),
});


// ── Helper ───────────────────────────────────────────────────────────────────
export function formatZodError(error: z.ZodError): string {
  return error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
}
