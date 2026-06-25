// ── Environment variable validation ─────────────────────────────
// Called at app startup via instrumentation.ts → register().
// All critical env vars are checked here so misconfiguration surfaces
// at boot time, not at runtime when the first wallet decrypt or Redis
// call fails with an opaque error.
//
// IMPORTANT: Redis uses KV_REST_API_URL / KV_REST_API_TOKEN
// (Vercel KV naming convention). These are the actual keys read by
// src/lib/redis/index.ts. Do NOT confuse with the UPSTASH_* aliases
// — those are not used anywhere in this codebase.
// ─────────────────────────────────────────────────────────────────

type EnvSpec = {
  name: string;
  /** Returns an error string if invalid, or null if OK */
  validate?: (value: string) => string | null;
};

const REQUIRED_VARS: EnvSpec[] = [
  // ── Database (Neon)
  {
    name: 'DATABASE_URL',
    validate: (v) =>
      v.startsWith('http') || v.startsWith('postgres')
        ? null
        : 'Must be a valid postgres:// or https:// URL',
  },

  // ── Clerk auth
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' },
  { name: 'CLERK_SECRET_KEY' },

  // ── Wallet encryption (AES-256-GCM)
  {
    name: 'ENCRYPTION_KEY',
    validate: (v) =>
      /^[a-f0-9]{64}$/i.test(v.trim())
        ? null
        : 'Must be a 64-character hex string (32 bytes). Generate: openssl rand -hex 64',
  },

  // ── Upstash Redis / Vercel KV
  // These are the actual env var names used by src/lib/redis/index.ts.
  // Vercel KV provisions them as KV_REST_API_URL / KV_REST_API_TOKEN.
  {
    name: 'KV_REST_API_URL',
    validate: (v) => v.startsWith('https://') ? null : 'Must be a valid HTTPS URL',
  },
  { name: 'KV_REST_API_TOKEN' },

  // ── QStash (scheduled mint jobs)
  { name: 'QSTASH_TOKEN' },
  { name: 'QSTASH_CURRENT_SIGNING_KEY' },
  { name: 'QSTASH_NEXT_SIGNING_KEY' },

  // ── GoPlus Security (optional - for contract security scanning)
  // { name: 'GOPLUS_API_KEY' }, // Optional, not required
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
      if (error) errors.push(`  • ${spec.name}: ${error}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `\n\n❌ Environment configuration errors (${errors.length} issue(s)):\n${errors.join('\n')}\n\n` +
      'Fix the above variables in your .env.local or Vercel environment settings.\n',
    );
  }
}
