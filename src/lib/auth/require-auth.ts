import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { syncUser } from '@/lib/auth/sync-user';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

type SessionClaims = Record<string, unknown> | null;

type ApiAuthSuccess = {
  clerkId: string;
  sessionClaims: SessionClaims;
};

type ApiUserSuccess = ApiAuthSuccess & {
  userId: string;
};

type ApiAuthResult<T> = T | { error: NextResponse };

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

// ── API Key authentication ──────────────────────────────────────────────────
// Simple env-var-based API key for programmatic access (Gumloop, scripts, etc.)
//
// Set on Vercel:
//   AUTOMINT_API_KEY       = <random-secret>
//   AUTOMINT_API_KEY_USER  = <your-clerk-user-id>  (from Clerk dashboard)
//
// Usage:
//   curl -H "Authorization: Bearer <AUTOMINT_API_KEY>" https://your-app.vercel.app/api/mints
//
// The key is compared in constant time to prevent timing attacks.
// No DB table needed — this is a 2-person tool.
// ─────────────────────────────────────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function authenticateApiKey(): Promise<ApiUserSuccess | null> {
  const apiKey = process.env.AUTOMINT_API_KEY;
  const apiKeyClerkId = process.env.AUTOMINT_API_KEY_USER;
  if (!apiKey || !apiKeyClerkId) return null;

  const headersList = await headers();
  const authHeader = headersList.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!constantTimeEqual(token, apiKey)) return null;

  // Resolve the user from the Clerk ID tied to this API key
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.clerkId, apiKeyClerkId))
    .limit(1);

  if (!user) return null;

  return {
    clerkId: apiKeyClerkId,
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
  // 1. Try Clerk session first (browser / logged-in user)
  const session = await auth();
  if (session.userId) {
    const user = await syncUser(session.userId);
    if (user) {
      return {
        clerkId: session.userId,
        sessionClaims: session.sessionClaims as SessionClaims,
        userId: user.id,
      };
    }
  }

  // 2. Fall back to API key (programmatic access — Gumloop, scripts, cURL)
  const apiKeyAuth = await authenticateApiKey();
  if (apiKeyAuth) return apiKeyAuth;

  return { error: jsonError('Unauthorized', 401) };
}
