import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { monitoredWebsites } from '@/drizzle/schema/monitoring';
import { eq } from 'drizzle-orm';
import { currentUser } from '@clerk/nextjs/server';

// GET /api/monitoring/websites
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const dbUser = await getDb().select().from(require('@/drizzle/schema').users)
      .where(eq(require('@/drizzle/schema').users.clerkId, user.id))
      .limit(1);

    if (dbUser.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const websites = await getDb().select().from(monitoredWebsites)
      .where(eq(monitoredWebsites.userId, dbUser[0].id))
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
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const dbUser = await getDb().select().from(require('@/drizzle/schema').users)
      .where(eq(require('@/drizzle/schema').users.clerkId, user.id))
      .limit(1);

    if (dbUser.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const body = await request.json();
    const { name, url, chain, websiteType, checkIntervalMinutes, browserSessionId } = body;

    // Validate URL
    if (!url || !url.startsWith('http://') && !url.startsWith('https://')) {
      return NextResponse.json({ error: 'Invalid URL: must start with http:// or https://' }, { status: 400 });
    }

    const [website] = await getDb().insert(monitoredWebsites).values({
      userId: dbUser[0].id,
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