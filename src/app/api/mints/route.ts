import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { addMintTask, executeMintTask, getMintTaskById, getUserMintTasks, removeMintTask, updateMintTaskStatus } from '@/lib/services/mint.service';
import { cancelScheduledMint, scheduleMint } from '@/lib/services/qstash.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { getDb } from '@/lib/db';
import { collections, mintTasks } from '@/drizzle/schema';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { resolveMintIntent, type MintIntent } from '@/lib/resolve-mint-intent';
import { AnalyzerResolutionError, normalizeAnalyzerInput, runAnalyzer, type AnalyzerResult } from '@/lib/services/analyzer.service';
import { analyzeMintRisk } from '@/lib/services/risk.service';

// Cache GET requests for 30 seconds
export const revalidate = 30;

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

function asSupportedChain(chain: string): SupportedChain {
  if (!SUPPORTED_CHAINS.includes(chain as SupportedChain)) {
    throw new Error(`Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
  }
  return chain as SupportedChain;
}

async function upsertCollectionFromMintIntent(userId: string, intent: MintIntent, analysis: AnalyzerResult | null) {
  if (!intent.contractAddress) {
    throw new AnalyzerResolutionError(intent);
  }

  const chain = asSupportedChain(intent.chain);
  const contractAddress = intent.contractAddress.toLowerCase();
  const collectionValues = {
    name: analysis?.metadata.name ?? intent.collectionName ?? intent.collectionSlug ?? 'Unknown Collection',
    tokenStandard: analysis?.metadata.tokenStandard,
    owner: analysis?.metadata.owner,
    totalSupply: analysis?.metadata.totalSupply,
    mintStatus: analysis?.mintState.status.toLowerCase(),
    mintPrice: analysis?.requirements.mintPrice,
    mintStart: analysis?.requirements.mintStartTime ?? analysis?.mintState.startTime,
    mintEnd: analysis?.requirements.mintEndTime ?? analysis?.mintState.endTime,
    lastSyncedAt: analysis ? new Date() : undefined,
    updatedAt: new Date(),
  };

  const [existing] = await getDb()
    .select()
    .from(collections)
    .where(and(eq(collections.userId, userId), eq(collections.contractAddress, contractAddress), eq(collections.chain, chain)))
    .limit(1);

  if (existing) {
    if (!analysis) return existing;

    const [updated] = await getDb()
      .update(collections)
      .set(collectionValues)
      .where(eq(collections.id, existing.id))
      .returning();

    return updated ?? existing;
  }

  const [created] = await getDb()
    .insert(collections)
    .values({
      userId,
      contractAddress,
      chain,
      ...collectionValues,
    })
    .returning();

  return created;
}

async function applyAnalyzerResultToTask(taskId: string, analysis: AnalyzerResult) {
  const [task] = await getDb()
    .update(mintTasks)
    .set({
      mintFunction: analysis.mintFunction.functionName || analysis.requirements.mintFunction,
      mintPrice: analysis.requirements.mintPrice,
      updatedAt: new Date(),
    })
    .where(eq(mintTasks.id, taskId))
    .returning();

  await analyzeMintRisk(taskId);
  return task;
}

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
      mintUrl?: string;
      analysisConfirmed?: boolean;
      quantity?: string | number;
      safeModeEnabled?: boolean;
      gasStrategy?: 'STANDARD' | 'FAST' | 'AGGRESSIVE';
      maxRetries?: number;
      riskThreshold?: number;
    }>(req);
    const { quantity, safeModeEnabled } = body;
    const defaults = await getEffectiveExecutionDefaults(authResult.userId);
    const walletId = body.walletId || defaults.defaultWalletId || undefined;
    let collectionId = body.collectionId;
    const mintUrl = body.mintUrl?.trim();

    if (!walletId || (!collectionId && !mintUrl)) {
      return NextResponse.json({ error: 'Wallet ID and Collection ID or Mint URL are required' }, { status: 400 });
    }

    let analysis: AnalyzerResult | null = null;
    let shouldScheduleFromUrl = false;
    if (mintUrl) {
      const normalizedInput = normalizeAnalyzerInput(mintUrl);
      if (defaults.autoRunAnalyzer || body.analysisConfirmed) {
        analysis = await runAnalyzer({
          userId: authResult.userId,
          input: normalizedInput,
          settings: defaults,
          notify: true,
        });
        shouldScheduleFromUrl = true;
      }

      const intent = analysis?.intent ?? await resolveMintIntent(normalizedInput);
      const collection = await upsertCollectionFromMintIntent(authResult.userId, intent, analysis);
      collectionId = collection.id;
    }

    if (!collectionId) {
      return NextResponse.json({ error: 'Collection ID could not be resolved' }, { status: 400 });
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

    const analyzedTask = analysis ? await applyAnalyzerResultToTask(task.id, analysis) : null;
    const preparedTask = analyzedTask ?? task;

    const [collection] = await getDb()
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, authResult.userId)))
      .limit(1);

    if (!collection) {
      return NextResponse.json({ task: preparedTask }, { status: 201 });
    }

    if (mintUrl && !shouldScheduleFromUrl) {
      return NextResponse.json({ task: preparedTask, collection, analyzerRequired: true }, { status: 201 });
    }

    const mintState = analysis?.mintState ?? await getMintState(collection.contractAddress, collection.chain);
    if (mintState.status !== 'LIVE' && mintState.status !== 'ENDED') {
      const detectedStart = mintState.startTime || collection.mintStart || undefined;
      const scheduledTime = detectedStart && detectedStart.getTime() > Date.now() ? detectedStart : undefined;
      const scheduledTask = await scheduleMint({ taskId: preparedTask.id, userId: authResult.userId, scheduledTime });

      return NextResponse.json({ task: scheduledTask, collection }, { status: 201 });
    }

    if (mintState.status === 'LIVE') {
      const readyTask = await updateMintTaskStatus(preparedTask.id, authResult.userId, 'ready');
      return NextResponse.json({ task: readyTask, collection }, { status: 201 });
    }

    return NextResponse.json({ task: preparedTask, collection }, { status: 201 });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to create mint task');
    if (error instanceof AnalyzerResolutionError) {
      return NextResponse.json({ error: message, intent: error.intent }, { status: error.status });
    }
    const status = message.includes('not found') ? 404 : message === 'Invalid JSON request body' || message.startsWith('Unsupported chain') ? 400 : 500;
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
