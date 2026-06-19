import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { activities } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await getDb().select().from(activities)
    .where(eq(activities.userId, clerkId))
    .orderBy(desc(activities.createdAt))
    .limit(50);

  return NextResponse.json({ activities: result });
}