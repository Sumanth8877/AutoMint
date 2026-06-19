import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { syncUser } from '@/lib/auth/sync-user';

export async function getCurrentUser() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  const result = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return result[0] || null;
}

/**
 * Resolve a Clerk ID to the internal users.id (UUID).
 *
 * This is the ONLY place where users.clerkId is queried.
 * All DB relations and comparisons MUST use the internal UUID.
 */
export async function getInternalUserId(clerkId: string): Promise<string> {
  const [user] = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user) return user.id;

  const syncedUser = await syncUser(clerkId);
  if (!syncedUser) throw new Error('User not found');

  return syncedUser.id;
}
