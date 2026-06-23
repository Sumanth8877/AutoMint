import 'server-only';

import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleServerless } from 'drizzle-orm/neon-serverless';
import { neon } from '@neondatabase/serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from '@/drizzle/schema';

// ── HTTP client (default) ─────────────────────────────────────────────────────
// Stateless HTTP transport — one request per query. Ideal for serverless
// functions where each invocation is short-lived. Zero connection overhead.

let _db: ReturnType<typeof drizzleHttp<typeof schema>> | null = null;

export function getDb(): ReturnType<typeof drizzleHttp<typeof schema>> {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set');
    }
    const sql = neon(url);
    _db = drizzleHttp(sql, { schema });
  }
  return _db;
}

// Lazy singleton accessor that TypeScript treats as non-null
export const db = new Proxy({} as ReturnType<typeof drizzleHttp<typeof schema>>, {
  get(_target, prop) {
    return getDb()[prop as keyof ReturnType<typeof drizzleHttp<typeof schema>>];
  },
});

export default db;

// ── WebSocket Pool client (high-concurrency routes) ───────────────────────────
// Use this for routes that run many parallel queries (e.g. whale tracker,
// analytics aggregation). Pool reuses WebSocket connections across queries
// within the same request, cutting per-query latency by ~40–60 ms.
//
// Usage:
//   import { getPoolDb } from '@/lib/db';
//   const dbPool = getPoolDb();
//   const rows = await dbPool.select().from(schema.mints);

let _pool: Pool | null = null;
let _poolDb: ReturnType<typeof drizzleServerless<typeof schema>> | null = null;

export function getPoolDb(): ReturnType<typeof drizzleServerless<typeof schema>> {
  if (!_poolDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set');
    }
    _pool = new Pool({ connectionString: url });
    _poolDb = drizzleServerless(_pool, { schema });
  }
  return _poolDb;
}
