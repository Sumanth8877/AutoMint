import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { addMintTask, executeMintTask, getMintTaskById, getUserMintTasks, removeMintTask } from '@/lib/services/mint.service';
import { cancelScheduledMint, scheduleMint } from '@/lib/services/qstash.service';
import { registerContractForMonitoring, unregisterContract } from '@/lib/services/alchemy-webhook.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { getDb } from '@/lib/db';
import { collections, mintTasks } from '@/drizzle/schema';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { SUPPORTED_CHAINS, type ChainKey } from '@/lib/blockchain/chains';
import { resolveMintIntent, type MintIntent } from '@/lib/resolve-mint-intent';
import { discoverMintRequirements } from '@/lib/services/mint-discovery.service';
import { logger } from '@/lib/logger';
import { mintCreateSchema, mintActionSchema, mintDeleteSchema, formatZodError } from '@/lib/api/schemas';
import type { MintPhase } from '@/types/mint';
import { addTaskLog } from '@/lib/services/task-log.service';

// Disable cache — mutations need fresh data immediately
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function asSupportedChain(chain: string): ChainKey {
  if (!(chain in SUPPORTED_CHAINS)) {
    throw new Error(`Unsupported chain. Supported: ${Object.keys(SUPPORTED_CHAINS).join(', ')}`);
  }
  return chain as ChainKey;
}

/**
 * Create or update a collection record from a resolved mint intent.
 * No analyzer dependency — uses intent metadata only.
 */
async function upsertCollectionFromMintIntent(userId: string, intent: MintIntent) {
  if (!intent.contractAddress) {
    throw new Error(`Could not resolve contract address from URL: ${intent.sourceUrl}`);
  }

  const chain = asSupportedChain(intent.chain);
  const contractAddress = intent.contractAddress.toLowerCase();

  const [existing] = await getDb()
    .select()
    .from(collections)
    .where(and(eq(collections.userId, userId), eq(collections.contractAddress, contractAddress), eq(collections.chain, chain)))
    .limit(1);

  if (existing) return existing;

  const [created] = await getDb()
    .insert(collections)
    .values({
      userId,
      contractAddress,
      chain,
      name: intent.collectionName ?? intent.collectionSlug ?? 'Unknown Collection',
      updatedAt: new Date(),
    })
    .returning();

  return created;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/mints — Optimized fast path (no analyzer, no QStash delay)
//
// BEFORE:  URL → runAnalyzer(2-5s) → getMintState(0.5-3s) → QStash(+5s) → execute
// AFTER:   URL → resolveMintIntent(0.5-1s) → [getMintState ∥ fetchMintRequirements](0.5-1s) → QStash(0s) → execute
//
// Removed: runAnalyzer() overhead, applyAnalyzerResultToTask(), 5s QStash delay
// Savings: ~5-10s per mint
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const rawBody = await parseJsonBody(req);
    const bodyParsed = mintCreateSchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json({ error: formatZodError(bodyParsed.error) }, { status: 400 });
    }
    const body = bodyParsed.data;
    const { quantity, safeModeEnabled, wlMode = false } = body;
    const defaults = await getEffectiveExecutionDefaults(authResult.userId);
    const walletId = body.walletId || defaults.defaultWalletId || undefined;
    let collectionId = body.collectionId;
    const mintUrl = body.mintUrl?.trim();

    if (!walletId || (!collectionId && !mintUrl)) {
      return NextResponse.json({ error: 'Wallet ID and Collection ID or Mint URL are required' }, { status: 400 });
    }

    // ── Fast path: URL → contract address (no analyzer, no market data) ──────
    if (mintUrl) {
      const intent = await resolveMintIntent(mintUrl);
      const collection = await upsertCollectionFromMintIntent(authResult.userId, intent);
      collectionId = collection.id;

      // Fire-and-forget Alchemy webhook registration
      if (intent.contractAddress) {
        void registerContractForMonitoring(intent.contractAddress).catch(() => {});
      }
    }

    if (!collectionId) {
      return NextResponse.json({ error: 'Collection ID could not be resolved' }, { status: 400 });
    }

    const fallbackQuantity = mintUrl ? 1 : defaults.defaultMintQuantity;
    const qty = Math.max(1, parseInt(String(quantity ?? fallbackQuantity), 10) || fallbackQuantity);
    const task = await addMintTask(authResult.userId, {
      walletId,
      collectionId,
      quantity: qty,
      safeModeEnabled: safeModeEnabled ?? false,
      gasStrategy: body.gasStrategy ?? defaults.gasStrategy,
      maxRetries: body.maxRetries ?? defaults.maxRetries,
      riskThreshold: body.riskThreshold ?? defaults.riskThreshold,
    });

    await addTaskLog(task.id, 'task_created', 'info', 'Mint task created');

    const [collection] = await getDb()
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, authResult.userId)))
      .limit(1);

    if (!collection) {
      return NextResponse.json({ task }, { status: 201 });
    }

    // ── Parallel: mint state + on-chain requirements (zero duplication) ───────
    // Both are independent RPC calls. Concurrent execution saves ~200-500ms.
    const [mintState, requirements] = await Promise.all([
      getMintState(collection.contractAddress, collection.chain),
      fetchMintRequirements(collection.contractAddress, collection.chain),
    ]);

    // Resolve the mint price. On-chain read is preferred. A null result means the
    // contract has no on-chain price getter (e.g. OpenSea / SeaDrop drops) — fall
    // back to off-chain discovery from the pasted mint URL, then the cached
    // collection price. We deliberately do NOT coerce an unknown price to '0':
    // a wrong 0 sends a 0-value mint that reverts and is misreported as a honeypot.
    let resolvedPrice: string | null = requirements.mintPrice;
    if (resolvedPrice == null && mintUrl) {
      const discoveredPrice = await discoverMintRequirements(mintUrl, {
        contractAddress: collection.contractAddress,
        chain: collection.chain,
      }).catch(() => null);
      resolvedPrice = discoveredPrice?.mintPrice ?? collection.mintPrice ?? null;
    } else if (resolvedPrice == null) {
      resolvedPrice = collection.mintPrice ?? null;
    }

    // Apply discovered mint function + price to the task
    await getDb()
      .update(mintTasks)
      .set({
        mintFunction: requirements.mintFunction ?? 'mint',
        mintPrice: resolvedPrice,
        updatedAt: new Date(),
      })
      .where(eq(mintTasks.id, task.id));

    // ── Mint state gating ────────────────────────────────────────────────────
    // Priority: ENDED → UNKNOWN → NOT_STARTED → LIVE

    if (mintState.status === 'ENDED') {
      await removeMintTask(task.id, authResult.userId).catch(() => {});
      return NextResponse.json(
        { error: 'This mint has already ended and is no longer mintable.' },
        { status: 422 },
      );
    }

    if (mintState.status === 'UNKNOWN') {
      if (mintUrl) {
        const discovered = await discoverMintRequirements(mintUrl, {
          contractAddress: collection.contractAddress,
          chain: collection.chain,
        });
        if (discovered.mintStartTime && discovered.mintStartTime.getTime() > Date.now()) {
          Object.assign(mintState, { status: 'NOT_STARTED' as const, startTime: discovered.mintStartTime });
        } else if (discovered.contractAddress) {
          Object.assign(mintState, { status: 'LIVE' as const });
        }
      }

      if (mintState.status === 'UNKNOWN') {
        await removeMintTask(task.id, authResult.userId).catch(() => {});
        return NextResponse.json(
          {
            error:
              'Mint status could not be determined for this collection. ' +
              'It may be closed, not yet announced, or use a custom contract. ' +
              'Please verify the mint page and try again.',
          },
          { status: 422 },
        );
      }
    }

    // NOT_STARTED (upcoming): schedule for mint start time.
    if (mintState.status === 'NOT_STARTED') {
      if (wlMode && mintUrl) {
        const discovered = await discoverMintRequirements(mintUrl, {
          contractAddress: collection.contractAddress,
          chain: collection.chain,
        });
        const nonPublicPhases = (discovered?.mintPhases ?? []).filter((p: MintPhase) => p.type !== 'public');
        if (nonPublicPhases.length === 0) {
          await removeMintTask(task.id, authResult.userId).catch(() => {});
          return NextResponse.json(
            { error: 'No upcoming WL / Allowlist phase found. The mint may only have a public phase.' },
            { status: 422 },
          );
        }
        const wlPhase = nonPublicPhases[0];
        const wlStartTime = wlPhase.startTime ?? mintState.startTime;
        await getDb().update(mintTasks)
          .set({ phase: wlPhase.type, mintPrice: wlPhase.price ?? collection.mintPrice ?? '0', updatedAt: new Date() })
          .where(eq(mintTasks.id, task.id));

        const scheduledWlTask = await scheduleMint({
          taskId: task.id,
          userId: authResult.userId,
          scheduledTime: wlStartTime && wlStartTime.getTime() > Date.now() ? wlStartTime : undefined,
        });
        return NextResponse.json(
          { task: scheduledWlTask, collection, mintStatus: 'upcoming', scheduledTime: wlStartTime?.toISOString() ?? null, wlPhase: wlPhase.type },
          { status: 201 },
        );
      }

      let detectedStart: Date | undefined =
        mintState.startTime ??
        (collection.mintStart ? new Date(collection.mintStart) : undefined);

      if (!detectedStart && mintUrl) {
        logger.info('startTime missing — running discoverMintRequirements for timing', { area: 'mints/route' });
        const discovered = await discoverMintRequirements(mintUrl, {
          contractAddress: collection.contractAddress,
          chain: collection.chain,
        });
        if (discovered.mintStartTime) {
          detectedStart = discovered.mintStartTime;
          logger.info('Discovery found startTime', { area: 'mints/route', startTime: detectedStart.toISOString() });
        }
      }

      const scheduledTime =
        detectedStart && detectedStart.getTime() > Date.now() ? detectedStart : undefined;

      const scheduledTask = await scheduleMint({
        taskId: task.id,
        userId: authResult.userId,
        scheduledTime,
      });

      return NextResponse.json(
        { task: scheduledTask, collection, mintStatus: 'upcoming', scheduledTime: scheduledTime?.toISOString() ?? null },
        { status: 201 },
      );
    }

    // ── LIVE mint ────────────────────────────────────────────────────────────
    //
    // WL mode needs phase discovery to find the right non-public phase.
    // Public mode skips discovery entirely — getMintState() already confirmed
    // the contract is LIVE on-chain (publicMintActive() = true). Skipping
    // discoverMintRequirements() saves 2-5s of Jina/Firecrawl scraping.
    // If the on-chain call reverts, the retry mechanism handles it.

    if (wlMode) {
      const discoveredForPhase = mintUrl ? await discoverMintRequirements(mintUrl, {
        contractAddress: collection.contractAddress,
        chain: collection.chain,
      }) : null;
      const allPhases = discoveredForPhase?.mintPhases ?? [];

      const nonPublicPhases = allPhases.filter((p: MintPhase) => p.type !== 'public');
      if (nonPublicPhases.length === 0) {
        await removeMintTask(task.id, authResult.userId).catch(() => {});
        return NextResponse.json(
          { error: 'No WL / Allowlist / Free-mint phase found for this collection. Uncheck the box and use the public mint instead.' },
          { status: 422 },
        );
      }

      const wlPhase = nonPublicPhases[0];
      const wlPhaseIsLive = !wlPhase.startTime || wlPhase.startTime.getTime() <= Date.now();

      await getDb()
        .update(mintTasks)
        .set({ phase: wlPhase.type, mintPrice: wlPhase.price ?? '0', updatedAt: new Date() })
        .where(eq(mintTasks.id, task.id));

      if (wlPhaseIsLive) {
        const scheduledWlTask = await scheduleMint({
          taskId: task.id,
          userId: authResult.userId,
          scheduledTime: new Date(),
          initialStatus: 'ready',
        });
        return NextResponse.json(
          { task: scheduledWlTask, collection, mintStatus: 'live', autoTriggered: true, wlPhase: wlPhase.type },
          { status: 201 },
        );
      } else {
        const scheduledWlTask = await scheduleMint({
          taskId: task.id,
          userId: authResult.userId,
          scheduledTime: wlPhase.startTime,
        });
        return NextResponse.json(
          { task: scheduledWlTask, collection, mintStatus: 'upcoming', scheduledTime: wlPhase.startTime!.toISOString(), wlPhase: wlPhase.type },
          { status: 201 },
        );
      }
    }

    // ── Public live mint — fast path (no phase discovery) ────────────────────
    // getMintState() confirmed LIVE on-chain. Execute immediately via QStash
    // with zero delay. The on-chain simulation inside executeScheduledMint()
    // serves as the final safety net — if the mint isn't actually open for
    // public, the tx reverts and is retried automatically.
    await addTaskLog(task.id, 'mint_state_live', 'success', 'Mint is LIVE on-chain — executing immediately');
    await getDb()
      .update(mintTasks)
      .set({ phase: 'public', updatedAt: new Date() })
      .where(eq(mintTasks.id, task.id));

    const autoTask = await scheduleMint({
      taskId: task.id,
      userId: authResult.userId,
      scheduledTime: new Date(),
      initialStatus: 'ready',
    });

    return NextResponse.json(
      {
        task: autoTask,
        collection,
        mintStatus: 'live',
        autoTriggered: true,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error, 'Failed to process mint request');
  }
}


// PATCH /api/mints
export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const rawPatch = await parseJsonBody(req);
    const patchParsed = mintActionSchema.safeParse(rawPatch);
    if (!patchParsed.success) {
      return NextResponse.json({ error: formatZodError(patchParsed.error) }, { status: 400 });
    }
    const body = patchParsed.data;

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
    return handleRouteError(error, 'Failed to process mint request');
  }
}

// DELETE /api/mints
export async function DELETE(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;


    const rawDel = await parseJsonBody(req);
    const delParsed = mintDeleteSchema.safeParse(rawDel);
    if (!delParsed.success) {
      return NextResponse.json({ error: formatZodError(delParsed.error) }, { status: 400 });
    }
    const { id } = delParsed.data;

    const existing = await getMintTaskById(id, authResult.userId);
    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (existing.qstashMessageId) {
      await cancelScheduledMint(id, authResult.userId);
    }

    await removeMintTask(id, authResult.userId);

    // Unregister from Alchemy webhook — best-effort, non-blocking
    if (existing.contractAddress) {
      void unregisterContract(existing.contractAddress).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Failed to process mint request');
  }
}
