import { getDb } from '@/lib/db';
import { notifications } from '@/drizzle/schema/notifications';
import { eq } from 'drizzle-orm';

export async function createNotification(params: { userId: string; type: string; title: string; message: string; metadata?: Record<string, any>; }) {
  const [row] = await getDb().insert(notifications).values({ userId: params.userId, type: params.type as any, title: params.title, message: params.message, metadata: params.metadata || {} }).returning();
  return row;
}

export async function getUserNotifications(userId: string, limit = 50) {
  return getDb().select().from(notifications).where(eq(notifications.userId, userId)).orderBy(notifications.createdAt).limit(limit);
}

export async function markNotificationRead(id: string, userId: string) {
  await getDb().update(notifications).set({ read: true, readAt: new Date() }).where(eq(notifications.id, id));
}
