import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { mintHistory } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';

// GET /api/history
export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const history = await getDb().select().from(mintHistory)
    .where(eq(mintHistory.userId, authResult.userId))
    .orderBy(desc(mintHistory.createdAt));
  
  return NextResponse.json({ history });
}
