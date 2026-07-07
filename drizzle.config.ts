import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for Drizzle commands');
}

export default defineConfig({
  schema: [
    './src/drizzle/schema/index.ts',
    './src/drizzle/schema/tasks.ts',
    './src/drizzle/schema/monitoring.ts',
    './src/drizzle/schema/wl-tracker.ts',
  ],
  out: './src/drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
