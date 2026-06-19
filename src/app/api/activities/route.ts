import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { activities } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';

export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const result = await getDb().select().from(activities)
    .where(eq(activities.userId, authResult.userId))
    .orderBy(desc(activities.createdAt))
    .limit(50);

  return NextResponse.json({ activities: result });
}
