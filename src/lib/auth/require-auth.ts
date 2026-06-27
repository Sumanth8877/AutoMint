import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { syncUser } from '@/lib/auth/sync-user';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { authenticateApiKey } from '@/lib/services/api-key.service';

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

// ── API Key authentication (DB-backed) ──────────────────────────────
// Keys are created via /settings/api-keys and stored as SHA-256 hashes.
//
// Usage:
//   curl -H "Authorization: Bearer am_<secret>" https://your-app.vercel.app/api/mints
//
// Falls back to the legacy env-var key (AUTOMINT_API_KEY) for backwards
// compatibility during migration. Remove the fallback once all keys are
// migrated to the DB.
// ─────────────────────────────────────────────────────────────────────

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function authenticateBearer(): Promise<ApiUserSuccess | null> {
  const headersList = await headers();
  const authHeader = headersList.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);

  // ── Primary: DB-backed API keys ──
  const dbResult = await authenticateApiKey(token);
  if (dbResult) {
    return {
      clerkId: '', // API-key auth doesn't have a Clerk session
      sessionClaims: null,
      userId: dbResult.userId,
    };
  }

  // ── Fallback: legacy env-var key (remove after migration) ──
  const legacyKey = process.env.AUTOMINT_API_KEY;
  const legacyClerkId = process.env.AUTOMINT_API_KEY_USER;
  if (legacyKey && legacyClerkId && constantTimeEqual(token, legacyKey)) {
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.clerkId, legacyClerkId))
      .limit(1);

    if (user) {
      return {
        clerkId: legacyClerkId,
        sessionClaims: null,
        userId: user.id,
      };
    }
  }

  return null;
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
  // Try Bearer token (API key) first
  const apiKeyAuth = await authenticateBearer();
  if (apiKeyAuth) return apiKeyAuth;

  // Fall back to Clerk session
  const session = await auth();

  if (!session.userId) {
    return { error: jsonError('Unauthorized', 401) };
  }

  const dbUser = await syncUser(session.userId);

  return {
    clerkId: session.userId,
    sessionClaims: session.sessionClaims as SessionClaims,
    userId: dbUser.id,
  };
}
