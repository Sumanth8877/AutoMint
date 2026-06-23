import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { monitoredWebsites } from '@/drizzle/schema/monitoring';
import { eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { captureException } from '@/lib/observability/sentry';

// GET /api/monitoring/websites
export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const websites = await getDb().select().from(monitoredWebsites)
      .where(eq(monitoredWebsites.userId, authResult.userId))
      .orderBy(monitoredWebsites.createdAt);

    return NextResponse.json(websites);
  } catch (error) {
    captureException(error, { area: 'api', context: { route: 'monitoring/websites' }, fingerprint: ['api', 'monitoring-websites-get'] });
    return NextResponse.json({ error: 'Failed to fetch websites' }, { status: 500 });
  }
}

// POST /api/monitoring/websites
export async function POST(request: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await request.json();
    const { name, url, chain, websiteType, checkIntervalMinutes, browserSessionId } = body;

    // Validate URL
    if (!url || !url.startsWith('http://') && !url.startsWith('https://')) {
      return NextResponse.json({ error: 'Invalid URL: must start with http:// or https://' }, { status: 400 });
    }

    const [website] = await getDb().insert(monitoredWebsites).values({
      userId: authResult.userId,
      name: name || new URL(url).hostname,
      url,
      chain: chain || null,
      websiteType: websiteType || 'mint_page',
      checkIntervalMinutes: checkIntervalMinutes || 5,
      browserSessionId: browserSessionId || null,
    }).returning();

    return NextResponse.json(website);
  } catch (error) {
    captureException(error, { area: 'api', context: { route: 'monitoring/websites' }, fingerprint: ['api', 'monitoring-websites-post'] });
    return NextResponse.json({ error: 'Failed to create website' }, { status: 500 });
  }
}
