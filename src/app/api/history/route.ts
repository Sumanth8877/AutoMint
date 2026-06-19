import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users, mintHistory } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

// GET /api/history
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ history: [] });

  const history = await getDb().select().from(mintHistory)
    .where(eq(mintHistory.userId, user[0].id))
    .orderBy(desc(mintHistory.createdAt));
  
  return NextResponse.json({ history });
}