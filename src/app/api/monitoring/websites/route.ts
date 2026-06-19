import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { monitoredWebsites } from '@/drizzle/schema/monitoring';
import { eq } from 'drizzle-orm';
import { getInternalUserId } from '@/lib/auth/current-user';

// GET /api/monitoring/websites
export async function GET() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = await getInternalUserId(clerkId);

    const websites = await getDb().select().from(monitoredWebsites)
      .where(eq(monitoredWebsites.userId, userId))
      .orderBy(monitoredWebsites.createdAt);

    return NextResponse.json(websites);
  } catch (error) {
    console.error('GET /api/monitoring/websites error:', error);
    return NextResponse.json({ error: 'Failed to fetch websites' }, { status: 500 });
  }
}

// POST /api/monitoring/websites
export async function POST(request: Request) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = await getInternalUserId(clerkId);

    const body = await request.json();
    const { name, url, chain, websiteType, checkIntervalMinutes, browserSessionId } = body;

    // Validate URL
    if (!url || !url.startsWith('http://') && !url.startsWith('https://')) {
      return NextResponse.json({ error: 'Invalid URL: must start with http:// or https://' }, { status: 400 });
    }

    const [website] = await getDb().insert(monitoredWebsites).values({
      userId,
      name: name || new URL(url).hostname,
      url,
      chain: chain || null,
      websiteType: websiteType || 'mint_page',
      checkIntervalMinutes: checkIntervalMinutes || 5,
      browserSessionId: browserSessionId || null,
    }).returning();

    return NextResponse.json(website);
  } catch (error) {
    console.error('POST /api/monitoring/websites error:', error);
    return NextResponse.json({ error: 'Failed to create website' }, { status: 500 });
  }
}