import { NextResponse } from 'next/server';

// Public — no auth. Used by uptime monitors (e.g. Better Uptime, Checkly).
// Listed in middleware.ts isPublicRoute so Clerk does not redirect this.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
