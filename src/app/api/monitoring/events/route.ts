import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { monitoringEvents, monitoredWebsites } from '@/drizzle/schema/monitoring';
import { eq, desc } from 'drizzle-orm';
import { getInternalUserId } from '@/lib/auth/current-user';

export async function GET(request: Request) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = await getInternalUserId(clerkId);

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

    // Query monitoring events joined with monitored_websites to filter by userId
    const rows = await getDb().select({
      event: monitoringEvents,
      website: monitoredWebsites,
    }).from(monitoringEvents)
      .innerJoin(monitoredWebsites, eq(monitoringEvents.websiteId, monitoredWebsites.id))
      .where(eq(monitoredWebsites.userId, userId))
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