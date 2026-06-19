import { getDb } from '@/lib/db';
import { activities } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { getCollectionMetadata } from '@/lib/blockchain/collections';

export type ActivityType = 
  | 'wallet_added' 
  | 'wallet_balance_changed'
  | 'collection_added' 
  | 'task_created' 
  | 'task_cancelled' 
  | 'task_completed' 
  | 'collection_live' 
  | 'mint_ending_soon' 
  | 'floor_price_changed' 
  | 'mint_status_changed';

export async function logActivity(userId: string, type: ActivityType, title: string, metadata?: Record<string, any>) {
  try {
    await getDb().insert(activities).values({
      userId,
      type,
      title,
      metadata: metadata || {},
    });
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
}

export async function getRecentActivities(userId: string, limit = 20) {
  const result = await getDb().select().from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(activities.createdAt)
    .limit(limit);
  return result;
}

export async function syncCollectionMetadata(collectionId: string, contractAddress: string, chain: string) {
  try {
    const metadata = await getCollectionMetadata(contractAddress, chain);
    return metadata;
  } catch (error) {
    console.error(`Failed to sync collection ${collectionId}:`, error);
    throw error;
  }
}