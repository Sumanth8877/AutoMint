import { getDb } from '@/lib/db';
import { collections, users } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { getCollectionMetadata } from '@/lib/blockchain/collections';

export async function getUserCollections(userId: string) {
  const result = await getDb().select().from(collections).where(eq(collections.userId, userId)).orderBy(collections.createdAt);
  return result;
}

export async function addCollection(userId: string, data: { name: string; contractAddress: string; chain: string }) {
  const user = await getDb().select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (user.length === 0) throw new Error('User not found');

  const [collection] = await getDb().insert(collections).values({
    userId: user[0].id,
    name: data.name,
    contractAddress: data.contractAddress.toLowerCase(),
    chain: data.chain as 'ethereum' | 'base' | 'polygon',
  }).returning();

  // Best-effort metadata sync
  try {
    const metadata = await getCollectionMetadata(data.contractAddress, data.chain);
    await getDb().update(collections)
      .set({
        name: metadata.name,
        tokenStandard: metadata.tokenStandard,
        owner: metadata.owner,
        totalSupply: metadata.totalSupply.toString(),
        lastSyncedAt: new Date(),
      })
      .where(eq(collections.id, collection.id));
  } catch (error) {
    console.error('Background metadata sync failed:', error);
  }

  return collection;
}

export async function removeCollection(id: string, userId: string) {
  const existing = await getDb().select().from(collections).where(and(eq(collections.id, id), eq(collections.userId, userId))).limit(1);
  if (existing.length === 0) throw new Error('Collection not found');

  await getDb().delete(collections).where(and(eq(collections.id, id), eq(collections.userId, userId)));
  return { success: true };
}