import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { syncUser } from '@/lib/auth/sync-user';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { secureCompare } from '@/lib/security/timing-safe-compare';

type SessionClaims = Record<string, unknown> | null;

// `clerkId` is null when the caller authenticated via the API key env-var
// (there's no Clerk session in that flow). Downstream code MUST handle null
// rather than assuming an empty string would safely fall through DB lookups.
type ApiAuthSuccess = {
  clerkId: string | null;
  sessionClaims: SessionClaims;
};

type ApiUserSuccess = ApiAuthSuccess & {
  userId: string;
};

type ApiAuthResult<T> = T | { error: NextResponse };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

// ── API Key authentication (env-var-backed) ──────────────────────────────────
// Single shared API key controlled via Vercel env vars:
//   AUTOMINT_API_KEY       — the bearer token value
//   AUTOMINT_API_KEY_USER  — the Clerk user id that the key acts as
//
// Usage:
//   curl -H "Authorization: Bearer <AUTOMINT_API_KEY>" https://your-app/api/...
// ─────────────────────────────────────────────────────────────────────────────

async function authenticateBearer(): Promise<ApiUserSuccess | null> {
  const headersList = await headers();
  const authHeader = headersList.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);

  const expected = process.env.AUTOMINT_API_KEY;
  const ownerClerkId = process.env.AUTOMINT_API_KEY_USER;
  if (!expected || !ownerClerkId) return null;
  // secureCompare hashes both sides to a fixed-length digest before the
  // constant-time compare, so it never branches on input length the way a
  // naive `if (a.length !== b.length) return false` + timingSafeEqual would.
  if (!secureCompare(token, expected)) return null;

  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.clerkId, ownerClerkId))
    .limit(1);

  if (!user) return null;

  return {
    clerkId: ownerClerkId,
    sessionClaims: null,
    userId: user.id,
  };
}

export async function requireApiSession(): Promise<ApiAuthResult<ApiAuthSuccess>> {
  const session = await auth();

  if (!session.userId) {
    return { error: jsonError('Unauthorized', 401) };
  }

  return {
    clerkId: session.userId,
    sessionClaims: session.sessionClaims as SessionClaims,
  };
}

export async function requireApiUser(): Promise<ApiAuthResult<ApiUserSuccess>> {
  // Try Bearer token (env-var API key) first
  try {
    const apiKeyAuth = await authenticateBearer();
    if (apiKeyAuth) return apiKeyAuth;
  } catch {
    // Bearer auth failed (e.g. DB error) — fall through to Clerk session
  }

  // Fall back to Clerk session
  const session = await auth();

  if (!session.userId) {
    return { error: jsonError('Unauthorized', 401) };
  }

  // FIX: wrap syncUser in try/catch so DB errors (e.g. missing columns
  // from unapplied migrations) return a structured error instead of
  // throwing an unhandled exception that crashes the calling page.
  try {
    const dbUser = await syncUser(session.userId);

    if (!dbUser) {
      return { error: jsonError('User not found', 401) };
    }

    return {
      clerkId: session.userId,
      sessionClaims: session.sessionClaims as SessionClaims,
      userId: dbUser.id,
    };
  } catch (e) {
    console.error('[requireApiUser] syncUser failed:', e instanceof Error ? e.message : e);
    return { error: jsonError('Authentication failed — please try again', 500) };
  }
}
