import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { monitoringEvents, monitoredWebsites } from '@/drizzle/schema/monitoring';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const dbUser = await getDb().select().from(users)
      .where(eq(users.clerkId, userId)).limit(1);
    if (dbUser.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

    // Query monitoring events joined with monitored_websites to filter by userId
    const rows = await getDb().select({
      event: monitoringEvents,
      website: monitoredWebsites,
    }).from(monitoringEvents)
      .innerJoin(monitoredWebsites, eq(monitoringEvents.websiteId, monitoredWebsites.id))
      .where(eq(monitoredWebsites.userId, dbUser[0].id))
      .orderBy(desc(monitoringEvents.createdAt))
      .limit(limit);

    const events = rows.map(r => ({
      id: r.event.id,
      websiteId: r.event.websiteId,
      eventType: r.event.eventType,
      severity: r.event.severity,
      oldSnapshot: r.event.oldSnapshot,
      newSnapshot: r.event.newSnapshot,
      metadata: r.event.metadata,
      createdAt: r.event.createdAt,
      website: {
        id: r.website.id,
        name: r.website.name,
        url: r.website.url,
        websiteType: r.website.websiteType,
        lastStatus: r.website.lastStatus,
      },
    }));

    return NextResponse.json(events);
  } catch (error) {
    console.error('GET /api/monitoring/events error:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}