import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    testTimeout: 15_000,
    reporters: process.env.CI ? ['verbose'] : ['default'],
    // Audit fix: enforce a minimum coverage floor so regressions in
    // critical-path tests are caught at PR time rather than in production.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Coverage is informational at this stage — the floor is set low
      // enough to not block development but high enough to catch a
      // catastrophic drop in test coverage.
      thresholds: {
        statements: 40,
        branches: 30,
        functions: 35,
        lines: 40,
      },
      // Only count source files, not test files or config.
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/**/*.test.ts',
        'src/lib/**/__tests__/**',
        'src/lib/email-templates/**',
        'src/lib/clerk-appearance.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'server-only': resolve(__dirname, './src/test/server-only.ts'),
    },
  },
});
