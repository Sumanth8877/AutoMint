import { getDb } from '@/lib/db';
import { activities, notifications } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { getCollectionMetadata } from '@/lib/blockchain/collections';

export type ActivityType = 'wallet_added' | 'collection_added' | 'task_created' | 'task_cancelled' | 'task_completed' | 'collection_live' | 'mint_ending_soon' | 'floor_price_changed' | 'mint_status_changed';

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

export async function createNotification(userId: string, title: string, message: string, channel: 'email' | 'in_app' | 'discord' | 'telegram' = 'in_app') {
  try {
    await getDb().insert(notifications).values({
      userId,
      title,
      message,
      channel,
      status: 'pending',
      read: false,
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
}

export async function getRecentActivities(userId: string, limit = 20) {
  const result = await getDb().select().from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(activities.createdAt)
    .limit(limit);
  return result;
}

export async function getNotifications(userId: string) {
  const result = await getDb().select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(notifications.createdAt);
  return result;
}

export async function markNotificationRead(id: string, userId: string) {
  await getDb().update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id));
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