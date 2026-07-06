import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getAIStatus } from '@/lib/services/provider-health.service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ai/status
 * Returns the health status of all AI providers.
 * Used by the dashboard to show a warning banner when Gemini is down.
 */
export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const status = await getAIStatus();

  return NextResponse.json(status);
}
