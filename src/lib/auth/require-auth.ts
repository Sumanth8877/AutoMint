import 'server-only';

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { syncUser } from '@/lib/auth/sync-user';

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
  const session = await requireApiSession();
  if ('error' in session) return session;

  const user = await syncUser(session.clerkId);
  if (!user) {
    return { error: jsonError('Unauthorized', 401) };
  }

  return {
    ...session,
    userId: user.id,
  };
}
