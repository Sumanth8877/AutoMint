import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { monitoredWebsites } from '@/drizzle/schema/monitoring';
import { eq, and } from 'drizzle-orm';
import { getInternalUserId } from '@/lib/auth/current-user';

// DELETE /api/monitoring/websites/:id
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = await getInternalUserId(clerkId);

    const { id: websiteId } = await params;

    const [deleted] = await getDb()
      .delete(monitoredWebsites)
      .where(and(eq(monitoredWebsites.id, websiteId), eq(monitoredWebsites.userId, userId)))
      .returning();

    if (!deleted) return NextResponse.json({ error: 'Website not found' }, { status: 404 });

    return NextResponse.json({ success: true, id: websiteId });
  } catch (error) {
    console.error('DELETE /api/monitoring/websites/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete website' }, { status: 500 });
  }
}
