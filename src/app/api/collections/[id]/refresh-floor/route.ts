import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collections } from '@/drizzle/schema';
import { requireApiUser } from '@/lib/auth/require-auth';
import { handleRouteError } from '@/lib/api/errors';
import { syncCollectionFloorPrice } from '@/lib/services/collection.service';

// Collection floor data changes on refresh -- disable ISR
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST /api/collections/[id]/refresh-floor
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await params;

    const [collection] = await getDb()
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), eq(collections.userId, authResult.userId)))
      .limit(1);

    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    const updated = await syncCollectionFloorPrice(
      collection.id,
      collection.contractAddress,
      collection.chain,
      collection.name,
    );

    if (!updated) {
      return NextResponse.json({ error: 'Floor price unavailable for this collection right now' }, { status: 502 });
    }

    return NextResponse.json({ collection: updated });
  } catch (error) {
    return handleRouteError(error, 'Failed to refresh floor price');
  }
}
