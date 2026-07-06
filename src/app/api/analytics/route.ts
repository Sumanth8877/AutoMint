import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getAnalyticsDashboard } from '@/lib/services/analytics.service';

export async function GET() {
  const auth = await requireApiUser();
  if ('error' in auth) return auth.error;

  try {
    const dashboard = await getAnalyticsDashboard(auth.userId);
    return NextResponse.json({ dashboard });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load analytics' }, { status: 500 });
  }
}
