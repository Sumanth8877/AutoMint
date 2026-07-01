import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { sql } from 'drizzle-orm';

// Public — no auth. Used by QStash keepalive and uptime monitors.
// Listed in middleware.ts isPublicRoute so Clerk does not redirect this.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    // Ping the DB so Neon stays awake (free tier suspends after 5 days of inactivity).
    // This route is called every 3 days by the QStash keepalive schedule.
    await getDb().execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true, db: 'ok', ts: Date.now() });
  } catch (_error) {
    // Return 200 so uptime monitors don't false-alarm on a transient DB blip.
    // Omit the raw error.message — it can expose internal DB connection details
    // (host, port, credentials) to anyone who hits this public endpoint.
    return NextResponse.json(
      { ok: false, db: 'error', ts: Date.now() },
      { status: 200 },
    );
  }
}
