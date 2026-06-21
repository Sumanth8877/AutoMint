import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/drizzle/schema/index.ts',
    './src/drizzle/schema/tasks.ts',
    './src/drizzle/schema/monitoring.ts',
  ],
  out: './src/drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
