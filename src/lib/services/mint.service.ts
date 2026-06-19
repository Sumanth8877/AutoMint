import { getDb } from '@/lib/db';
import { mintTasks, users, wallets, collections } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

export async function getUserMintTasks(userId: string) {
  const result = await getDb().select().from(mintTasks).where(eq(mintTasks.userId, userId)).orderBy(mintTasks.createdAt);
  return result;
}

export async function addMintTask(userId: string, data: { walletId: string; collectionId: string; quantity: number }) {
  const user = await getDb().select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (user.length === 0) throw new Error('User not found');

  const [task] = await getDb().insert(mintTasks).values({
    userId: user[0].id,
    walletId: data.walletId,
    collectionId: data.collectionId,
    quantity: data.quantity,
    status: 'pending',
  }).returning();

  return task;
}

export async function removeMintTask(id: string, userId: string) {
  const existing = await getDb().select().from(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId))).limit(1);
  if (existing.length === 0) throw new Error('Task not found');

  await getDb().delete(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId)));
  return { success: true };
}