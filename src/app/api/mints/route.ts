import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users, wallets, collections, mintTasks } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'];

// GET /api/mints
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ tasks: [] });

  const tasks = await getDb().select().from(mintTasks)
    .where(eq(mintTasks.userId, user[0].id))
    .orderBy(desc(mintTasks.createdAt));
  
  return NextResponse.json({ tasks });
}

// POST /api/mints
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { walletId, collectionId, quantity } = body;

  if (!walletId || !collectionId) {
    return NextResponse.json({ error: 'Wallet ID and Collection ID are required' }, { status: 400 });
  }

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const qty = Math.max(1, parseInt(quantity as string) || 1);
  const [task] = await getDb().insert(mintTasks).values({
    userId: user[0].id,
    walletId,
    collectionId,
    quantity: qty,
    status: 'pending',
  }).returning();

  return NextResponse.json({ task }, { status: 201 });
}

// DELETE /api/mints
export async function DELETE(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });

  const user = await getDb().select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (user.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  await getDb().delete(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, user[0].id)));
  return NextResponse.json({ success: true });
}