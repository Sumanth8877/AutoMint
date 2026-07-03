import 'server-only';

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';

export async function POST() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    await getDb()
      .update(users)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, authResult.userId));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const [user] = await getDb()
      .select({ onboardingCompletedAt: users.onboardingCompletedAt })
      .from(users)
      .where(eq(users.id, authResult.userId))
      .limit(1);

    return NextResponse.json({
      completed: Boolean(user?.onboardingCompletedAt),
      completedAt: user?.onboardingCompletedAt?.toISOString() ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to check onboarding status' }, { status: 500 });
  }
}
