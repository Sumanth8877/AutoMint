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

function claimString(claims: SessionClaims, key: string) {
  const value = claims?.[key];
  return typeof value === 'string' ? value : null;
}

function nestedClaimString(claims: SessionClaims, parent: string, key: string) {
  const value = claims?.[parent];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === 'string' ? nested : null;
}

function getAdminAllowlist() {
  return (process.env.ADMIN_CLERK_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAdminSession(clerkId: string, claims: SessionClaims) {
  if (getAdminAllowlist().includes(clerkId)) return true;

  const role =
    claimString(claims, 'role') ??
    nestedClaimString(claims, 'metadata', 'role') ??
    nestedClaimString(claims, 'publicMetadata', 'role');

  return role === 'admin' || claimString(claims, 'org_role') === 'org:admin';
}

export async function requireAdminApiSession(): Promise<ApiAuthResult<ApiAuthSuccess>> {
  const session = await requireApiSession();
  if ('error' in session) return session;

  if (!isAdminSession(session.clerkId, session.sessionClaims)) {
    return { error: jsonError('Forbidden', 403) };
  }

  return session;
}
