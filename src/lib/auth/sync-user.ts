import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function syncUser() {
  const { userId: clerkId, sessionClaims } = await auth();

  if (!clerkId) return null;

  const email = sessionClaims?.email as string || '';
  const username = sessionClaims?.username as string || sessionClaims?.name as string || '';

  // Check if user exists
  const existing = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

  if (existing.length > 0) {
    // Update email/username if changed
    const user = existing[0];
    if (user.email !== email || user.username !== username) {
      await getDb().update(users)
        .set({ email, username, updatedAt: new Date() })
        .where(eq(users.clerkId, clerkId));
    }
    return existing[0];
  }

  // Create new user
  const [newUser] = await getDb().insert(users).values({
    clerkId,
    email,
    username: username || null,
  }).returning();

  return newUser;
}