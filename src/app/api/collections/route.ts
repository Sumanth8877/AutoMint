import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { addCollection, getUserCollections, removeCollection } from '@/lib/services/collection.service';

// Collections change on add/remove — disable ISR so React Query always gets fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/collections
export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const userCollections = await getUserCollections(authResult.userId);
    return NextResponse.json({ collections: userCollections });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to fetch collections') }, { status: 500 });
  }
}

// POST /api/collections
export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ name?: string; contractAddress?: string; chain?: string }>(req);
    const { name, contractAddress, chain } = body;

    if (!name || !contractAddress || !chain) {
      return NextResponse.json({ error: 'Name, contractAddress, and chain are required' }, { status: 400 });
    }

    const collection = await addCollection(authResult.userId, { name, contractAddress, chain });

    return NextResponse.json({ collection }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create collection');
  }
}

// DELETE /api/collections
export async function DELETE(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ id?: string }>(req);
    const { id } = body;

    if (!id) return NextResponse.json({ error: 'Collection ID is required' }, { status: 400 });

    await removeCollection(id, authResult.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to delete collection');
    const status = message.includes('not found') ? 404 : message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
