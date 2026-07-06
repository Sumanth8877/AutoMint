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
        : 'Must be a 64-character hex string (32 bytes). Generate: openssl rand -hex 32',
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

  // ── Alchemy (primary RPC provider — all mint transactions go through this)
  // Without this key all on-chain calls fall back to slower providers or fail.
  { name: 'ALCHEMY_API_KEY' },
];

function validateAppUrl(): string | null {
  const candidates = [
    ['APP_URL', process.env.APP_URL],
    ['NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL],
    // Stable production domain (auto-set by Vercel) — preferred over the
    // ephemeral VERCEL_URL for QStash webhook destination + signature match.
    ['VERCEL_PROJECT_PRODUCTION_URL', process.env.VERCEL_PROJECT_PRODUCTION_URL],
    ['VERCEL_URL', process.env.VERCEL_URL],
  ] as const;

  for (const [name, rawValue] of candidates) {
    const value = rawValue?.trim();
    if (!value) continue;

    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(withScheme);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return `${name}: must use http:// or https://`;
      }
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        return `${name}: must not include credentials, query, or hash`;
      }
      if (parsed.pathname !== '/' && parsed.pathname !== '') {
        return `${name}: must be an origin URL or hostname without a path`;
      }
      return null;
    } catch {
      return `${name}: must be a valid absolute URL or hostname`;
    }
  }

  return 'APP_URL, NEXT_PUBLIC_APP_URL, VERCEL_PROJECT_PRODUCTION_URL, or VERCEL_URL: one is required for QStash destination URLs';
}

export function validateEnv(): void {
  const errors: string[] = [];

  for (const spec of REQUIRED_VARS) {
    const value = process.env[spec.name]?.trim();

    if (!value) {
      errors.push(`  \u2022 ${spec.name}: missing`);
      continue;
    }

    if (spec.validate) {
      const error = spec.validate(value);
      if (error) errors.push(`  \u2022 ${spec.name}: ${error}`);
    }
  }

  const appUrlError = validateAppUrl();
  if (appUrlError) errors.push(`  \u2022 ${appUrlError}`);

  if (errors.length > 0) {
    throw new Error(
      `\n\n\u274c Environment configuration errors (${errors.length} issue(s)):\n${errors.join('\n')}\n\n` +
      'Fix the above variables in your .env.local or Vercel environment settings.\n',
    );
  }

  // ── Warn about optional-but-important vars ────────────────────────────────
  // These do not crash startup but will cause runtime failures for specific
  // features. Console warnings surface them in deployment logs without blocking.
  const warnings: string[] = [];

  const optionalImportant: Array<{ name: string; reason: string }> = [
    {
      name: 'CRON_SECRET',
      reason: 'POST /api/recovery/mint returns 503 — stuck-mint recovery loop cannot be triggered',
    },
    {
      name: 'ALCHEMY_WEBHOOK_SIGNING_KEY',
      reason: 'All Alchemy contract/wallet webhooks will be rejected (signature verification fails)',
    },
  ];

  // Telegram vars are only needed when the feature is enabled
  const telegramEnabled = process.env.TELEGRAM_ENABLED?.trim().toLowerCase() === 'true';
  if (telegramEnabled) {
    optionalImportant.push(
      {
        name: 'TELEGRAM_BOT_TOKEN',
        reason: 'TELEGRAM_ENABLED=true but bot token missing — all Telegram notifications will fail',
      },
      {
        name: 'TELEGRAM_WEBHOOK_SECRET',
        reason: 'TELEGRAM_ENABLED=true but webhook secret missing — all webhook requests rejected',
      },
      {
        name: 'NARA_API_KEY',
        reason: 'TELEGRAM_ENABLED=true but Nara Router API key missing — Telegram AI interpreter commands will fail',
      },
    );
  }

  for (const { name, reason } of optionalImportant) {
    if (!process.env[name]?.trim()) {
      warnings.push(`  \u26a0 ${name}: ${reason}`);
    }
  }

  if (warnings.length > 0) {
    console.warn(
      `\n\u26a0 AutoMint optional env var warnings (${warnings.length}):\n${warnings.join('\n')}\n`,
    );
  }
}
