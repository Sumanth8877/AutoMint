import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function syncUser(clerkId?: string) {
  // If clerkId is not provided, get it from auth (for backward compatibility)
  if (!clerkId) {
    const { userId } = await auth();
    clerkId = userId ?? undefined;
  }

  if (!clerkId) return null;

  // Note: We can't access sessionClaims from middleware context
  // For middleware sync, we'll just ensure the user exists
  // Full sync with email/username happens on first authenticated request

  // Check if user exists
  const existing = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create new user with minimal data
  const [newUser] = await getDb().insert(users).values({
    clerkId,
    email: '',
    username: null,
  }).returning();

  return newUser;
}