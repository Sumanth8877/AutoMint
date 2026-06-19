import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { collections, mintTasks, wallets } from '@/drizzle/schema';
import { eq, desc, and } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';

// GET /api/mints
export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const tasks = await getDb().select().from(mintTasks)
    .where(eq(mintTasks.userId, authResult.userId))
    .orderBy(desc(mintTasks.createdAt));
  
  return NextResponse.json({ tasks });
}

// POST /api/mints
export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const body = await req.json();
  const { walletId, collectionId, quantity } = body;

  if (!walletId || !collectionId) {
    return NextResponse.json({ error: 'Wallet ID and Collection ID are required' }, { status: 400 });
  }

  const userId = authResult.userId;
  const [wallet] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)))
    .limit(1);

  if (!wallet) {
    return NextResponse.json({ error: 'Wallet not found' }, { status: 404 });
  }

  const [collection] = await getDb()
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.id, collectionId), eq(collections.userId, userId)))
    .limit(1);

  if (!collection) {
    return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
  }

  const qty = Math.max(1, parseInt(quantity as string) || 1);
  const [task] = await getDb().insert(mintTasks).values({
    userId,
    walletId,
    collectionId,
    quantity: qty,
    status: 'pending',
  }).returning();

  return NextResponse.json({ task }, { status: 201 });
}

// DELETE /api/mints
export async function DELETE(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });

  await getDb().delete(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, authResult.userId)));
  return NextResponse.json({ success: true });
}
