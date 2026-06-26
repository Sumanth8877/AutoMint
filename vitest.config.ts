import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [],
    // Match Next.js project structure
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    // Timeout generous enough for async blockchain mocks
    testTimeout: 15_000,
    // Suppress verbose output in CI
    reporter: process.env.CI ? 'verbose' : 'default',
  },
  resolve: {
    alias: {
      // Mirror tsconfig @/* → src/*
      '@': resolve(__dirname, './src'),
    },
  },
});
