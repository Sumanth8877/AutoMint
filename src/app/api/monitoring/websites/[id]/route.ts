import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { monitoredWebsites, monitoringEvents } from '@/drizzle/schema/monitoring';
import { eq, and } from 'drizzle-orm';
import { currentUser } from '@clerk/nextjs/server';

// DELETE /api/monitoring/websites/:id
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await currentUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const dbUser = await getDb().select().from(require('@/drizzle/schema').users)
      .where(eq(require('@/drizzle/schema').users.clerkId, user.id))
      .limit(1);

    if (dbUser.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const { id: websiteId } = await params;

    const [deleted] = await getDb()
      .delete(monitoredWebsites)
      .where(and(eq(monitoredWebsites.id, websiteId), eq(monitoredWebsites.userId, dbUser[0].id)))
      .returning();

    if (!deleted) return NextResponse.json({ error: 'Website not found' }, { status: 404 });

    return NextResponse.json({ success: true, id: websiteId });
  } catch (error) {
    console.error('DELETE /api/monitoring/websites/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete website' }, { status: 500 });
  }
}