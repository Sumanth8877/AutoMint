import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { mintTasks } from '@/drizzle/schema';
import { eq, desc } from 'drizzle-orm';
import { getInternalUserId } from '@/lib/auth/current-user';

// GET /api/mints
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = await getInternalUserId(clerkId);

  const tasks = await getDb().select().from(mintTasks)
    .where(eq(mintTasks.userId, userId))
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

  const userId = await getInternalUserId(clerkId);

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
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { id } = body;

  if (!id) return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });

  const userId = await getInternalUserId(clerkId);

  await getDb().delete(mintTasks).where(eq(mintTasks.id, id));
  return NextResponse.json({ success: true });
}