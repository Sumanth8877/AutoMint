import type { NextConfig } from "next";

let nextConfig: NextConfig = {
  /* config options here */
};

// Boot-time environment validation (fail fast on missing config)
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { validateEnv } = require('@/lib/config/validate');
  validateEnv();
} catch (e) {
  console.error('[Config Validation]', e instanceof Error ? e.message : e);
  process.exit(1);
}

export default nextConfig;
