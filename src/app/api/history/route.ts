import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { mintHistory } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { getInternalUserId } from '@/lib/auth/current-user';

// GET /api/history
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = await getInternalUserId(clerkId);

  const history = await getDb().select().from(mintHistory)
    .where(eq(mintHistory.userId, userId))
    .orderBy(desc(mintHistory.createdAt));
  
  return NextResponse.json({ history });
}