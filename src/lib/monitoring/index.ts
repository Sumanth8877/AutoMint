import { getDb } from '@/lib/db';
import { activities } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { addBreadcrumb } from '@/lib/observability/sentry';

export type ActivityType = 
  | 'wallet_added' 
  | 'wallet_removed'
  | 'wallet_imported'
  | 'wallet_balance_changed'
  | 'collection_added' 
  | 'task_created' 
  | 'task_cancelled' 
  | 'task_completed' 
  | 'collection_live' 
  | 'mint_ending_soon' 
  | 'floor_price_changed' 
  | 'mint_status_changed';

export async function logActivity(userId: string, type: ActivityType, title: string, metadata?: Record<string, unknown>) {
  try {
    await getDb().insert(activities).values({
      userId,
      type,
      title,
      metadata: metadata || {},
    });
  } catch (error) {
    addBreadcrumb({ category: 'monitoring', message: 'Failed to log activity', level: 'error', data: { error: String(error) } });
  }
}

export async function getRecentActivities(userId: string, limit = 20) {
  const result = await getDb().select().from(activities)
    .where(eq(activities.userId, userId))
    .orderBy(desc(activities.createdAt))
    .limit(limit);
  return result;
}
