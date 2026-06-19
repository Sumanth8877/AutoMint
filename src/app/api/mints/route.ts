import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { addMintTask, getUserMintTasks, removeMintTask, updateMintTaskStatus } from '@/lib/services/mint.service';

// GET /api/mints
export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const tasks = await getUserMintTasks(authResult.userId);
    return NextResponse.json({ tasks });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to fetch mint tasks') }, { status: 500 });
  }
}

// POST /api/mints
export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ walletId?: string; collectionId?: string; quantity?: string | number }>(req);
    const { walletId, collectionId, quantity } = body;

    if (!walletId || !collectionId) {
      return NextResponse.json({ error: 'Wallet ID and Collection ID are required' }, { status: 400 });
    }

    const qty = Math.max(1, parseInt(String(quantity ?? '1'), 10) || 1);
    const task = await addMintTask(authResult.userId, { walletId, collectionId, quantity: qty });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to create mint task');
    const status = message.includes('not found') ? 404 : message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// PATCH /api/mints
export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ id?: string; action?: 'start' | 'cancel' }>(req);

    if (!body.id) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    if (body.action !== 'start' && body.action !== 'cancel') {
      return NextResponse.json({ error: 'Action must be start or cancel' }, { status: 400 });
    }

    const task = await updateMintTaskStatus(
      body.id,
      authResult.userId,
      body.action === 'start' ? 'running' : 'cancelled',
    );

    return NextResponse.json({ task });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to update mint task');
    const status = message.includes('not found') ? 404 : message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/mints
export async function DELETE(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ id?: string }>(req);
    const { id } = body;

    if (!id) return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });

    await removeMintTask(id, authResult.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to delete mint task');
    const status = message.includes('not found') ? 404 : message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
