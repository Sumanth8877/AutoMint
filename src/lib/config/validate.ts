/**
 * Environment variable validation.
 * Called at boot time to fail fast on missing critical configuration.
 *
 * NEVER use NEXT_PUBLIC_* prefix for secrets or RPC access.
 * All blockchain keys are server-only.
 */

export function validateEnv() {
  const requiredVars: { key: string; description: string }[] = [
    { key: 'DATABASE_URL', description: 'PostgreSQL connection string' },
    { key: 'ALCHEMY_API_KEY', description: 'Alchemy RPC API key (server-only)' },
  ];

  const missing: string[] = [];
  for (const { key, description } of requiredVars) {
    if (!process.env[key]) {
      missing.push(`  • ${key} — ${description}`);
    }
  }

  if (missing.length > 0) {
    const message = [
      'FATAL: Missing required environment variables.',
      'Create a .env file based on .env.example and set the following:',
      '',
      ...missing,
      '',
      'Application will now exit.',
    ].join('\n');

    console.error(message);
    throw new Error('Missing required environment variables');
  }

  // Sanity check: ensure NEXT_PUBLIC_ALCHEMY_API_KEY is not in use
  if (process.env.NEXT_PUBLIC_ALCHEMY_API_KEY) {
    console.warn(
      'WARNING: NEXT_PUBLIC_ALCHEMY_API_KEY is set but ignored. ' +
      'Use ALCHEMY_API_KEY (server-only) instead. ' +
      'Remove NEXT_PUBLIC_ALCHEMY_API_KEY from your .env file.',
    );
  }
}