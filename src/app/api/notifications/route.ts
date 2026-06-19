import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { notifications } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userNotifications = await getDb().select().from(notifications)
    .where(eq(notifications.userId, clerkId))
    .orderBy(desc(notifications.createdAt));
  return NextResponse.json({ notifications: userNotifications });
}

export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { title, message, channel = 'in_app' } = body;

  if (!title || !message) {
    return NextResponse.json({ error: 'Title and message are required' }, { status: 400 });
  }

  const [notification] = await getDb().insert(notifications).values({
    userId: clerkId,
    title,
    message,
    channel,
    status: 'pending',
    read: false,
  }).returning();

  return NextResponse.json({ notification }, { status: 201 });
}

export async function PATCH(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Notification ID is required' }, { status: 400 });

  await getDb().update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id));

  return NextResponse.json({ success: true });
}