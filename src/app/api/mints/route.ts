import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { addMintTask, executeMintTask, getMintTaskById, getUserMintTasks, removeMintTask, updateMintTaskStatus } from '@/lib/services/mint.service';
import { cancelScheduledMint, scheduleMint } from '@/lib/services/qstash.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { getDb } from '@/lib/db';
import { collections } from '@/drizzle/schema';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';

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

    const body = await parseJsonBody<{
      walletId?: string;
      collectionId?: string;
      quantity?: string | number;
      safeModeEnabled?: boolean;
      gasStrategy?: 'STANDARD' | 'FAST' | 'AGGRESSIVE';
      maxRetries?: number;
      riskThreshold?: number;
    }>(req);
    const { collectionId, quantity, safeModeEnabled } = body;
    const defaults = await getEffectiveExecutionDefaults(authResult.userId);
    const walletId = body.walletId || defaults.defaultWalletId || undefined;

    if (!walletId || !collectionId) {
      return NextResponse.json({ error: 'Wallet ID and Collection ID are required' }, { status: 400 });
    }

    const qty = Math.max(1, parseInt(String(quantity ?? defaults.defaultMintQuantity), 10) || defaults.defaultMintQuantity);
    const task = await addMintTask(authResult.userId, {
      walletId,
      collectionId,
      quantity: qty,
      safeModeEnabled: safeModeEnabled ?? false,
      gasStrategy: body.gasStrategy ?? defaults.gasStrategy,
      maxRetries: body.maxRetries ?? defaults.maxRetries,
      riskThreshold: body.riskThreshold ?? defaults.riskThreshold,
    });

    const [collection] = await getDb()
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, authResult.userId)))
      .limit(1);

    if (!collection) {
      return NextResponse.json({ task }, { status: 201 });
    }

    const mintState = await getMintState(collection.contractAddress, collection.chain);
    if (mintState.status !== 'LIVE' && mintState.status !== 'ENDED') {
      const detectedStart = mintState.startTime || collection.mintStart || undefined;
      const scheduledTime = detectedStart && detectedStart.getTime() > Date.now() ? detectedStart : undefined;
      const scheduledTask = await scheduleMint({ taskId: task.id, userId: authResult.userId, scheduledTime });

      return NextResponse.json({ task: scheduledTask }, { status: 201 });
    }

    if (mintState.status === 'LIVE') {
      const readyTask = await updateMintTaskStatus(task.id, authResult.userId, 'ready');
      return NextResponse.json({ task: readyTask }, { status: 201 });
    }

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

    if (body.action === 'cancel') {
      const task = await cancelScheduledMint(body.id, authResult.userId);
      return NextResponse.json({ task });
    }

    const result = await executeMintTask(body.id, authResult.userId);
    const task = await getMintTaskById(body.id, authResult.userId);

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    return NextResponse.json({ task, result });
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

    const existing = await getMintTaskById(id, authResult.userId);
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (existing.qstashMessageId) {
      await cancelScheduledMint(id, authResult.userId);
    }

    await removeMintTask(id, authResult.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to delete mint task');
    const status = message.includes('not found') ? 404 : message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
