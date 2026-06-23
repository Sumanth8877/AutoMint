import { z } from 'zod';

// ── Environment variable validation ──────────────────────────────
// Validated at startup (called from instrumentation.ts).
// All critical env vars are checked here so misconfiguration is caught
// at boot time, not at runtime when the first wallet is decrypted or
// the first Redis call is made.
//
// Add new required vars to the schema below. Optional vars (e.g.
// ENCRYPTION_KEY_PREVIOUS for key rotation) are typed as z.string().optional().
// ─────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid URL' }),

  // Clerk auth
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required'),
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),

  // Encryption (wallet private keys)
  ENCRYPTION_KEY: z.string().regex(
    /^[a-f0-9]{64}$/i,
    'ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate with: openssl rand -hex 64'
  ),
  ENCRYPTION_KEY_PREVIOUS: z.string().optional(), // for key rotation

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().url({ message: 'UPSTASH_REDIS_REST_URL must be a valid URL' }),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  // QStash (scheduled jobs)
  QSTASH_TOKEN: z.string().min(1, 'QSTASH_TOKEN is required'),
  QSTASH_CURRENT_SIGNING_KEY: z.string().min(1, 'QSTASH_CURRENT_SIGNING_KEY is required'),
  QSTASH_NEXT_SIGNING_KEY: z.string().min(1, 'QSTASH_NEXT_SIGNING_KEY is required'),

  // Alchemy (RPC + webhooks)
  ALCHEMY_API_KEY: z.string().min(1).optional(),
  ALCHEMY_WEBHOOK_SIGNING_KEY: z.string().min(1).optional(),

  // Sentry (optional — app runs without it but errors won't be captured)
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

let _validatedEnv: Env | null = null;

/**
 * Validate and return all critical environment variables.
 * Call this at app startup (instrumentation.ts).
 * Throws a detailed error listing all missing/invalid vars.
 */
export function validateEnv(): Env {
  if (_validatedEnv) return _validatedEnv;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `\n\n❌ Environment configuration errors (${result.error.issues.length} issue(s)):\n${issues}\n\n` +
      'Fix the above variables in your .env.local or Vercel environment settings.\n'
    );
  }

  _validatedEnv = result.data;
  return _validatedEnv;
}
