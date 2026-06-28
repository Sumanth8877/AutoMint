import { auth, currentUser } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export async function syncUser(clerkId?: string) {
  let clerkUser: Awaited<ReturnType<typeof currentUser>> | null = null;

  if (!clerkId) {
    const { userId } = await auth();
    clerkId = userId ?? undefined;

    if (clerkId) {
      clerkUser = await currentUser();
    }
  }

  if (!clerkId) return null;

  const email = clerkUser?.primaryEmailAddress?.emailAddress ?? clerkUser?.emailAddresses[0]?.emailAddress ?? '';
  const displayName = [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') || null;
  const username = clerkUser?.username ?? displayName;

  const existing = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

  if (existing.length > 0) {
    const user = existing[0];
    const updates: Partial<typeof users.$inferInsert> = {};

    if (email && user.email !== email) updates.email = email;
    if (username && user.username !== username) updates.username = username;

    if (Object.keys(updates).length === 0) return user;

    const [updatedUser] = await getDb()
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();

    return updatedUser;
  }

  // M5 fix: previously a plain INSERT — two near-simultaneous first-login
  // requests for the same clerkId could both miss the SELECT above and race
  // into a unique-constraint violation on idx_users_clerk_id (one succeeds,
  // the other 500s). Use ON CONFLICT (clerkId) DO UPDATE so the loser of the
  // race returns the row the winner just inserted instead of throwing.
  // The SET uses COALESCE so we never overwrite a row's email/username with
  // an empty/null value if this call's Clerk fetch happened to be sparser.
  const [newUser] = await getDb()
    .insert(users)
    .values({
      clerkId,
      email,
      username,
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      set: {
        email: sql`COALESCE(NULLIF(EXCLUDED.email, ''), ${users.email})`,
        username: sql`COALESCE(EXCLUDED.username, ${users.username})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return newUser;
}
