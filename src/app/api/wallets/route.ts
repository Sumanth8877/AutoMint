import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { wallets } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { isValidEthereumAddress } from '@/lib/blockchain/wallet';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'];

// GET /api/wallets
export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const userWallets = await getDb().select().from(wallets).where(eq(wallets.userId, authResult.userId)).orderBy(wallets.createdAt);
  return NextResponse.json({ wallets: userWallets });
}

// POST /api/wallets
export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

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

  // Check for duplicate
  const existing = await getDb().select()
    .from(wallets)
    .where(and(eq(wallets.userId, authResult.userId), eq(wallets.address, address.toLowerCase())))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ error: 'Wallet already added' }, { status: 409 });
  }

  const [wallet] = await getDb().insert(wallets).values({
    userId: authResult.userId,
    address: address.toLowerCase(),
    nickname: nickname || null,
    chain,
  }).returning();

  return NextResponse.json({ wallet }, { status: 201 });
}

// DELETE /api/wallets
export async function DELETE(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Wallet ID is required' }, { status: 400 });

  await getDb().delete(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, authResult.userId)));
  return NextResponse.json({ success: true });
}
