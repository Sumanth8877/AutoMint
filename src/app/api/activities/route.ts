import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { activities } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { captureException } from '@/lib/observability/sentry';

// Cache GET requests for 4 hours
export const revalidate = 14400;

export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  try {
    const result = await getDb().select().from(activities)
      .where(eq(activities.userId, authResult.userId))
      .orderBy(desc(activities.createdAt))
      .limit(50);

    return NextResponse.json({ activities: result });
  } catch (error) {
    await captureException(error, {
      area: 'api',
      context: { route: 'activities', userId: authResult.userId },
      fingerprint: ['api', 'activities'],
    });
    return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 });
  }
}
