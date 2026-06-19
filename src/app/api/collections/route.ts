import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { collections } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getCollectionMetadata } from '@/lib/blockchain/collections';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'];

// GET /api/collections
export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const userCollections = await getDb().select().from(collections).where(eq(collections.userId, authResult.userId)).orderBy(collections.createdAt);
  return NextResponse.json({ collections: userCollections });
}

// POST /api/collections
export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const body = await req.json();
  const { name, contractAddress, chain } = body;

  if (!name || !contractAddress || !chain) {
    return NextResponse.json({ error: 'Name, contractAddress, and chain are required' }, { status: 400 });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    return NextResponse.json({ error: 'Invalid contract address format' }, { status: 400 });
  }

  if (!SUPPORTED_CHAINS.includes(chain)) {
    return NextResponse.json({ error: `Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}` }, { status: 400 });
  }

  // Check duplicate
  const existing = await getDb().select()
    .from(collections)
    .where(and(eq(collections.userId, authResult.userId), eq(collections.contractAddress, contractAddress.toLowerCase())))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: 'Collection already added' }, { status: 409 });
  }

  const [collection] = await getDb().insert(collections).values({
    userId: authResult.userId,
    name,
    contractAddress: contractAddress.toLowerCase(),
    chain,
  }).returning();

  // Best-effort metadata sync (non-blocking)
  try {
    const metadata = await getCollectionMetadata(contractAddress, chain);
    await getDb().update(collections)
      .set({
        name: metadata.name,
        tokenStandard: metadata.tokenStandard,
        owner: metadata.owner,
        totalSupply: metadata.totalSupply.toString(),
        lastSyncedAt: new Date(),
      })
      .where(eq(collections.id, collection.id));
  } catch (error) {
    console.error('Background metadata sync failed:', error);
  }

  return NextResponse.json({ collection }, { status: 201 });
}

// DELETE /api/collections
export async function DELETE(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Collection ID is required' }, { status: 400 });

  await getDb().delete(collections).where(and(eq(collections.id, id), eq(collections.userId, authResult.userId)));
  return NextResponse.json({ success: true });
}
