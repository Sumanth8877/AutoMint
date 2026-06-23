/**
 * require-admin.ts
 *
 * Admin-only guard for system maintenance endpoints.
 *
 * An admin is any user whose internal UUID is listed in
 * ADMIN_USER_IDS (comma-separated) OR whose Clerk email
 * matches ADMIN_EMAIL.
 *
 * If neither env var is set, admin access is DENIED for safety.
 */

import 'server-only';

import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

type AdminAuthResult =
  | { clerkId: string; userId: string; email: string }
  | { error: NextResponse };

/**
 * Verify the caller is an authenticated admin.
 * Returns { userId, clerkId, email } on success, or { error: Response } on failure.
 */
export async function requireAdmin(): Promise<AdminAuthResult> {
  const auth = await requireApiUser();
  if ('error' in auth) return auth;

  const adminIds = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // If neither env var is configured, block all admin access.
  if (adminIds.length === 0 && adminEmails.length === 0) {
    return {
      error: NextResponse.json(
        { error: 'Admin access not configured. Set ADMIN_USER_IDS or ADMIN_EMAILS.' },
        { status: 403 },
      ),
    };
  }

  // Fast path: UUID match
  if (adminIds.includes(auth.userId)) {
    const [user] = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);
    return { clerkId: auth.clerkId, userId: auth.userId, email: user?.email ?? '' };
  }

  // Email match
  if (adminEmails.length > 0) {
    const [user] = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    if (user && adminEmails.includes(user.email.toLowerCase())) {
      return { clerkId: auth.clerkId, userId: auth.userId, email: user.email };
    }
  }

  return {
    error: NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 }),
  };
}
