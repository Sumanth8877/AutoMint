import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { monitoredWebsites } from '@/drizzle/schema/monitoring';
import { eq, and } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';

// DELETE /api/monitoring/websites/:id
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id: websiteId } = await params;

    const [deleted] = await getDb()
      .delete(monitoredWebsites)
      .where(and(eq(monitoredWebsites.id, websiteId), eq(monitoredWebsites.userId, authResult.userId)))
      .returning();

    if (!deleted) return NextResponse.json({ error: 'Website not found' }, { status: 404 });

    return NextResponse.json({ success: true, id: websiteId });
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to delete website' }, { status: 500 });
  }
}
