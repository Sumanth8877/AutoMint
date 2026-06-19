import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

export async function getCurrentUser() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  const result = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return result[0] || null;
}