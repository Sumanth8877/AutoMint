import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { addMintTask, executeMintTask, getMintTaskById, getUserMintTasks, removeMintTask } from '@/lib/services/mint.service';
import { cancelScheduledMint, scheduleMint } from '@/lib/services/qstash.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { getDb } from '@/lib/db';
import { collections, mintTasks } from '@/drizzle/schema';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { SUPPORTED_CHAINS, type ChainKey } from '@/lib/blockchain/chains';
import { resolveMintIntent, type MintIntent } from '@/lib/resolve-mint-intent';
import { AnalyzerResolutionError, normalizeAnalyzerInput, runAnalyzer, type AnalyzerResult } from '@/lib/services/analyzer.service';
import { analyzeMintRisk } from '@/lib/services/risk.service';
import { discoverMintRequirements } from '@/lib/services/mint-discovery.service';
import { logger } from '@/lib/logger';
import { mintCreateSchema, mintActionSchema, mintDeleteSchema, formatZodError } from '@/lib/api/schemas';
import type { MintPhase } from '@/types/mint';

// Disable cache — mutations need fresh data immediately
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function asSupportedChain(chain: string): ChainKey {
  if (!(chain in SUPPORTED_CHAINS)) {
    throw new Error(`Unsupported chain. Supported: ${Object.keys(SUPPORTED_CHAINS).join(', ')}`);
  }
  return chain as ChainKey;
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
    if (!analysis) {
      logger.info('Skipping collection update — analysis is null', { area: 'mints/route', contractAddress });
      return existing;
    }

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

async function applyAnalyzerResultToTask(
  taskId: string,
  analysis: AnalyzerResult,
  mintUrl: string,
) {
  // Build what we already know from the analyzer
  const knownFromAnalyzer: Parameters<typeof discoverMintRequirements>[1] = {
    contractAddress: analysis.intent?.contractAddress,
    chain: analysis.intent?.chain,
    collectionName: analysis.intent?.collectionName,
    mintFunction: analysis.mintFunction?.functionName ?? analysis.requirements?.mintFunction,
    mintPrice: analysis.requirements?.mintPrice,
    mintStartTime: analysis.requirements?.mintStartTime ?? analysis.mintState?.startTime ?? undefined,
    mintEndTime: analysis.requirements?.mintEndTime ?? analysis.mintState?.endTime ?? undefined,
  };

  // Only escalate to Jina/Firecrawl/Browserbase if the analyzer left gaps
  const hasCriticalGaps =
    !knownFromAnalyzer.mintFunction ||
    !knownFromAnalyzer.mintPrice ||
    // Always discover for timing: even when LIVE another phase (holder/WL) may be active
    // while the PUBLIC phase is still upcoming. We need mintPhases to detect this.
    !knownFromAnalyzer.mintStartTime;

  let finalRequirements = knownFromAnalyzer;

  if (hasCriticalGaps && mintUrl) {
    logger.info('Analyzer left gaps — running discoverMintRequirements', { area: 'mints/route',  mintUrl });
    const discovered = await discoverMintRequirements(mintUrl, knownFromAnalyzer);
    finalRequirements = {
      contractAddress: knownFromAnalyzer.contractAddress ?? discovered.contractAddress,
      chain: knownFromAnalyzer.chain ?? discovered.chain,
      collectionName: knownFromAnalyzer.collectionName ?? discovered.collectionName,
      mintFunction: knownFromAnalyzer.mintFunction ?? discovered.mintFunction,
      mintPrice: knownFromAnalyzer.mintPrice ?? discovered.mintPrice,
      mintStartTime: knownFromAnalyzer.mintStartTime ?? discovered.mintStartTime,
      mintEndTime: knownFromAnalyzer.mintEndTime ?? discovered.mintEndTime,
    };
  }

  // Determine which mint phase this task targets.
  // Priority: active phase (startTime <= now) → first listed phase → LIVE default → null
  // Note: MintRequirements does not expose mintPhases; we infer from mintState + discovery.
  type PhaseType = 'whitelist' | 'allowlist' | 'public';
  let detectedPhase: PhaseType | undefined;
  if (analysis.mintState?.status === 'LIVE') {
    // Live mint with no specific phase data → default to public
    detectedPhase = 'public';
  } else if (analysis.mintState?.status === 'NOT_STARTED') {
    // Use whatever finalRequirements discovered (mintStartTime hints at upcoming non-public)
    detectedPhase = undefined; // phase set separately in NOT_STARTED branch
  }

  const [task] = await getDb()
    .update(mintTasks)
    .set({
      mintFunction: finalRequirements.mintFunction ?? 'mint',
      mintPrice: finalRequirements.mintPrice ?? '0',
      ...(detectedPhase ? { phase: detectedPhase } : {}),
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

    let analysis: AnalyzerResult | null = null;
    if (mintUrl) {
      const normalizedInput = normalizeAnalyzerInput(mintUrl);

      // Always run the analyzer for URL-based mints so we get phase, price,
      // and accurate mint state regardless of whether the contract address
      // was resolved from the URL alone. For a 2-user tool the cost is fine,
      // and the analyzer uses Redis caching so repeat calls are fast.
      analysis = await runAnalyzer({
        userId: authResult.userId,
        input: normalizedInput,
        settings: defaults,
        notify: true,
      });
      const intent = analysis.intent ?? await resolveMintIntent(normalizedInput);

      const collection = await upsertCollectionFromMintIntent(authResult.userId, intent, analysis);
      collectionId = collection.id;
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

    let preparedTask = analysis ? await applyAnalyzerResultToTask(task.id, analysis, mintUrl ?? '') : task;

    const [collection] = await getDb()
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, authResult.userId)))
      .limit(1);

    if (!collection) {
      return NextResponse.json({ task: preparedTask }, { status: 201 });
    }

    const mintState = analysis?.mintState ?? await getMintState(collection.contractAddress, collection.chain);

    // ── Mint state gating ──────────────────────────────────────────────────────
    // Priority: ENDED → UNKNOWN → NOT_STARTED → LIVE
    // Each branch either rejects with a clear error or creates the right task.

    // ENDED: reject immediately — nothing to do.
    if (mintState.status === 'ENDED') {
      await removeMintTask(preparedTask.id, authResult.userId).catch(() => {});
      return NextResponse.json(
        { error: 'This mint has already ended and is no longer mintable.' },
        { status: 422 },
      );
    }

    // UNKNOWN: on-chain state could not be determined.
    // Run full analyzer + tiered discovery to resolve. If still unknown, reject.
    if (mintState.status === 'UNKNOWN') {
      if (mintUrl && !analysis) {
        const normalizedInput = normalizeAnalyzerInput(mintUrl);
        analysis = await runAnalyzer({
          userId: authResult.userId,
          input: normalizedInput,
          settings: defaults,
          notify: true,
        });
        preparedTask = await applyAnalyzerResultToTask(preparedTask.id, analysis, mintUrl);
      }

      const resolvedStatus = analysis?.mintState.status ?? 'UNKNOWN';
      if (resolvedStatus === 'ENDED') {
        await removeMintTask(preparedTask.id, authResult.userId).catch(() => {});
        return NextResponse.json(
          { error: 'This mint has already ended and is no longer mintable.' },
          { status: 422 },
        );
      }
      if (resolvedStatus === 'UNKNOWN') {
        await removeMintTask(preparedTask.id, authResult.userId).catch(() => {});
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
      // Resolved to LIVE or NOT_STARTED — fall through with updated mintState
      Object.assign(mintState, analysis!.mintState);
    }

    // NOT_STARTED (upcoming): schedule for mint start time.
    if (mintState.status === 'NOT_STARTED') {
      // WL mode: look for non-public phase and use ITS start time
      if (wlMode && mintUrl) {
        const discovered = await discoverMintRequirements(mintUrl, {
          contractAddress: collection.contractAddress,
          chain: collection.chain,
        });
        const nonPublicPhases = (discovered?.mintPhases ?? []).filter((p: MintPhase) => p.type !== 'public');
        if (nonPublicPhases.length === 0) {
          await removeMintTask(preparedTask.id, authResult.userId).catch(() => {});
          return NextResponse.json(
            { error: 'No upcoming WL / Allowlist phase found. The mint may only have a public phase.' },
            { status: 422 },
          );
        }
        const wlPhase = nonPublicPhases[0];
        const wlStartTime = wlPhase.startTime ?? mintState.startTime;
        await getDb().update(mintTasks)
          .set({ phase: wlPhase.type, mintPrice: wlPhase.price ?? collection.mintPrice ?? '0', updatedAt: new Date() })
          .where(eq(mintTasks.id, preparedTask.id));

        const scheduledWlTask = await scheduleMint({
          taskId: preparedTask.id,
          userId: authResult.userId,
          scheduledTime: wlStartTime && wlStartTime.getTime() > Date.now() ? wlStartTime : undefined,
        });
        return NextResponse.json(
          {
            task: scheduledWlTask,
            collection,
            mintStatus: 'upcoming',
            scheduledTime: wlStartTime?.toISOString() ?? null,
            wlPhase: wlPhase.type,
          },
          { status: 201 },
        );
      }
      if (mintUrl && !analysis) {
        const normalizedInput = normalizeAnalyzerInput(mintUrl);
        analysis = await runAnalyzer({
          userId: authResult.userId,
          input: normalizedInput,
          settings: defaults,
          notify: true,
        });
        preparedTask = await applyAnalyzerResultToTask(preparedTask.id, analysis, mintUrl);
      }

      // Priority: user override → on-chain → collection DB → tiered discovery
      let detectedStart: Date | undefined;
      if (body.scheduleTime) {
        const parsed = new Date(body.scheduleTime);
        if (!isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
          detectedStart = parsed;
          logger.info('Using user-supplied schedule override', { area: 'mints/route', startTime: detectedStart.toISOString() });
        }
      }
      detectedStart =
        detectedStart ??
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
        taskId: preparedTask.id,
        userId: authResult.userId,
        scheduledTime,
      });

      return NextResponse.json(
        {
          task: scheduledTask,
          collection,
          mintStatus: 'upcoming',
          scheduledTime: scheduledTime?.toISOString() ?? null,
        },
        { status: 201 },
      );
    }

    // LIVE mint ──────────────────────────────────────────────────────────────
    // IMPORTANT: The contract may be LIVE because a HOLDER / WL phase is active,
    // while the PUBLIC phase is still upcoming. We must check public phase timing
    // before deciding to auto-execute vs schedule.
    const discoveredForPhase = mintUrl ? await discoverMintRequirements(mintUrl, {
      contractAddress: collection.contractAddress,
      chain: collection.chain,
    }) : null;
    const allPhases = discoveredForPhase?.mintPhases ?? [];

    if (wlMode) {
      // WL mode: find non-public phases (holder pass, allowlist, free mint, etc.)
      const nonPublicPhases = allPhases.filter((p: MintPhase) => p.type !== 'public');
      if (nonPublicPhases.length === 0) {
        await removeMintTask(preparedTask.id, authResult.userId).catch(() => {});
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
        .where(eq(mintTasks.id, preparedTask.id));

      if (wlPhaseIsLive) {
        // WL phase is live now — auto-execute immediately
        const wlExecuteTime = new Date(Date.now() + 5_000);
        const scheduledWlTask = await scheduleMint({
          taskId: preparedTask.id,
          userId: authResult.userId,
          scheduledTime: wlExecuteTime,
        });
        return NextResponse.json(
          { task: scheduledWlTask, collection, mintStatus: 'live', autoTriggered: true, wlPhase: wlPhase.type },
          { status: 201 },
        );
      } else {
        // WL phase is upcoming — schedule for its start time
        const scheduledWlTask = await scheduleMint({
          taskId: preparedTask.id,
          userId: authResult.userId,
          scheduledTime: wlPhase.startTime,
        });
        return NextResponse.json(
          { task: scheduledWlTask, collection, mintStatus: 'upcoming', scheduledTime: wlPhase.startTime!.toISOString(), wlPhase: wlPhase.type },
          { status: 201 },
        );
      }
    }

    // Public mint mode ─────────────────────────────────────────────────────────
    // Check if the PUBLIC phase specifically is still upcoming
    // (contract may be LIVE for a holder phase while public hasn't started yet)
    const publicPhase = allPhases.find((p: MintPhase) => p.type === 'public');
    const publicPhaseStart = publicPhase?.startTime
      ?? (collection.mintStart ? new Date(collection.mintStart) : undefined);

    if (publicPhaseStart && publicPhaseStart.getTime() > Date.now()) {
      // Public phase is upcoming — schedule for its exact start time
      await getDb()
        .update(mintTasks)
        .set({ phase: 'public', mintPrice: publicPhase?.price ?? preparedTask.mintPrice ?? '0', updatedAt: new Date() })
        .where(eq(mintTasks.id, preparedTask.id));

      const scheduledTask = await scheduleMint({
        taskId: preparedTask.id,
        userId: authResult.userId,
        scheduledTime: publicPhaseStart,
      });
      return NextResponse.json(
        { task: scheduledTask, collection, mintStatus: 'upcoming', scheduledTime: publicPhaseStart.toISOString() },
        { status: 201 },
      );
    }

    // Public mint is truly live now — auto-execute via QStash (~5s delay)
    await getDb()
      .update(mintTasks)
      .set({ phase: 'public', updatedAt: new Date() })
      .where(eq(mintTasks.id, preparedTask.id));

    const executionTime = new Date(Date.now() + 5_000);
    const autoTask = await scheduleMint({
      taskId: preparedTask.id,
      userId: authResult.userId,
      scheduledTime: executionTime,
    });
    return NextResponse.json(
      { task: autoTask, collection, mintStatus: 'live', autoTriggered: true },
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
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Failed to process mint request');
  }
}
