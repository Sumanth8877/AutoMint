import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users, collections } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'];

// GET /api/collections
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ collections: [] });

  const userCollections = await getDb().select().from(collections).where(eq(collections.userId, user[0].id)).orderBy(collections.createdAt);
  return NextResponse.json({ collections: userCollections });
}

// POST /api/collections
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Check duplicate
  const existing = await getDb().select()
    .from(collections)
    .where(and(eq(collections.userId, user[0].id), eq(collections.contractAddress, contractAddress.toLowerCase())))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: 'Collection already added' }, { status: 409 });
  }

  const [collection] = await getDb().insert(collections).values({
    userId: user[0].id,
    name,
    contractAddress: contractAddress.toLowerCase(),
    chain,
  }).returning();

  return NextResponse.json({ collection }, { status: 201 });
}

// DELETE /api/collections
export async function DELETE(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Collection ID is required' }, { status: 400 });

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await getDb().delete(collections).where(and(eq(collections.id, id), eq(collections.userId, user[0].id)));
  return NextResponse.json({ success: true });
}