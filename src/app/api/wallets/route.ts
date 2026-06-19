import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users, wallets } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { isValidEthereumAddress } from '@/lib/blockchain/wallet';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'];

// GET /api/wallets
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ wallets: [] });

  const userWallets = await getDb().select().from(wallets).where(eq(wallets.userId, user[0].id)).orderBy(wallets.createdAt);
  return NextResponse.json({ wallets: userWallets });
}

// POST /api/wallets
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { address, nickname, chain } = body;

  if (!address || !chain) {
    return NextResponse.json({ error: 'Address and chain are required' }, { status: 400 });
  }

  if (!isValidEthereumAddress(address)) {
    return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
  }

  if (!SUPPORTED_CHAINS.includes(chain)) {
    return NextResponse.json({ error: `Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}` }, { status: 400 });
  }

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Check for duplicate
  const existing = await getDb().select()
    .from(wallets)
    .where(and(eq(wallets.userId, user[0].id), eq(wallets.address, address.toLowerCase())))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: 'Wallet already added' }, { status: 409 });
  }

  const [wallet] = await getDb().insert(wallets).values({
    userId: user[0].id,
    address: address.toLowerCase(),
    nickname: nickname || null,
    chain,
  }).returning();

  return NextResponse.json({ wallet }, { status: 201 });
}

// DELETE /api/wallets
export async function DELETE(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Wallet ID is required' }, { status: 400 });

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await getDb().delete(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, user[0].id)));
  return NextResponse.json({ success: true });
}