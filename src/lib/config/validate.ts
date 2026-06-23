// ── Environment variable validation ─────────────────────────────
// Called at app startup (instrumentation.ts / next.config.ts).
// All critical env vars are checked here so misconfiguration is caught
// at boot time — not at runtime when the first wallet decrypt fails or
// the first Redis connection times out.
//
// Add new required vars to REQUIRED_VARS below.
// Optional vars (for key rotation, staging, etc.) are validated separately.
// ────────────────────────────────────────────────────────────────

type EnvSpec = {
  name: string;
  /** Optional custom validation beyond presence check */
  validate?: (value: string) => string | null; // returns error message or null
};

const REQUIRED_VARS: EnvSpec[] = [
  // ── Database
  { name: 'DATABASE_URL', validate: (v) => v.startsWith('http') || v.startsWith('postgres') ? null : 'Must be a valid URL' },

  // ── Clerk auth
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' },
  { name: 'CLERK_SECRET_KEY' },

  // ── Wallet encryption
  {
    name: 'ENCRYPTION_KEY',
    validate: (v) =>
      /^[a-f0-9]{64}$/i.test(v.trim())
        ? null
        : 'Must be a 64-character hex string (32 bytes). Generate: openssl rand -hex 64',
  },

  // ── Upstash Redis
  { name: 'UPSTASH_REDIS_REST_URL', validate: (v) => v.startsWith('https://') ? null : 'Must be a valid HTTPS URL' },
  { name: 'UPSTASH_REDIS_REST_TOKEN' },

  // ── QStash (scheduled mint jobs)
  { name: 'QSTASH_TOKEN' },
  { name: 'QSTASH_CURRENT_SIGNING_KEY' },
  { name: 'QSTASH_NEXT_SIGNING_KEY' },
];

export function validateEnv(): void {
  const errors: string[] = [];

  for (const spec of REQUIRED_VARS) {
    const value = process.env[spec.name]?.trim();

    if (!value) {
      errors.push(`  • ${spec.name}: missing`);
      continue;
    }

    if (spec.validate) {
      const error = spec.validate(value);
      if (error) {
        errors.push(`  • ${spec.name}: ${error}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `\n\n❌ Environment configuration errors (${errors.length} issue(s)):\n${errors.join('\n')}\n\n` +
      'Fix the above variables in your .env.local or Vercel environment settings.\n',
    );
  }
}
