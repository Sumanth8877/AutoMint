import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { addCollection, getUserCollections, removeCollection } from '@/lib/services/collection.service';
import { collectionCreateSchema, collectionDeleteSchema, formatZodError } from '@/lib/api/schemas';

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

    const body = await parseJsonBody<unknown>(req);
    const parsed = collectionCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { name, contractAddress, chain } = parsed.data;
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

    const body = await parseJsonBody<unknown>(req);
    const parsed = collectionDeleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }

    await removeCollection(parsed.data.id, authResult.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete collection');
  }
}
