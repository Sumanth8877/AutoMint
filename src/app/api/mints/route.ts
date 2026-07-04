import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { addMintTask, getMintTaskById, getUserMintTasks, removeMintTask } from '@/lib/services/mint.service';
import { cancelScheduledMint, scheduleMint, executeScheduledMint } from '@/lib/services/qstash.service';
import { registerContractForMonitoring, unregisterContract } from '@/lib/services/alchemy-webhook.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { getDb } from '@/lib/db';
import { collections, mintTasks } from '@/drizzle/schema';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { SUPPORTED_CHAINS, type ChainKey } from '@/lib/blockchain/chains';
import { resolveMintIntent, type MintIntent } from '@/lib/resolve-mint-intent';
import { discoverMintRequirements } from '@/lib/services/mint-discovery.service';
import { isUnsupportedMintFunction, UNSUPPORTED_MINT_PREFIX } from '@/lib/services/mint-calldata.service';
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

/**
 * Execute a LIVE mint INLINE within this request, instead of round-tripping
 * through QStash (publish → Upstash queue → webhook delivery). That round
 * trip alone typically added ~300ms-1.5s of pure network/queue latency —
 * unnecessary when the mint is confirmed LIVE right now and we're already
 * inside a serverless invocation with time budget to spare (this route has
 * maxDuration: 10s; the full execution pipeline now completes in ~0.5-1.5s
 * per the optimizations in qstash.service.ts / blockchain/mint.ts).
 *
 * QStash remains the correct mechanism for genuinely FUTURE mints (NOT_STARTED
 * scheduling) — this helper is ONLY for the "mint is live right now" path.
 */
async function executeMintInline(taskId: string, userId: string) {
  // Mark the task 'ready' before executing — mirrors what scheduleMint() used
  // to set as the DB status for the QStash path, and lets executeScheduledMint's
  // "fresh task" fast-path skip the redundant mint-state/price re-check (it was
  // just verified moments ago in this same request).
  await getDb()
    .update(mintTasks)
    .set({ status: 'ready', qstashMessageId: null, updatedAt: new Date() })
    .where(eq(mintTasks.id, taskId));

  const mintResult = await executeScheduledMint(taskId);
  const finalTask = await getMintTaskById(taskId, userId);
  return { mintResult, finalTask: finalTask ?? null };
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
// POST /api/mints — Optimized fast path
//
// Pipeline: URL → resolve (with discovery fallback) → on-chain state ∥ requirements
//           → state gating → LIVE: execute inline / UPCOMING: schedule via QStash
//
// Key optimisations over the previous version:
//   1. Custom mint site support: when resolveMintIntent fails (no contract in URL),
//      falls back to discoverMintRequirements (Jina/Firecrawl/Browserbase) to
//      extract the contract address from the page content.
//   2. Single discovery call: all off-chain discovery is done once and the result
//      is reused for price, timing, and phase data — no redundant scraping.
//   3. Direct execution for LIVE mints: executeMintTask() is called inline,
//      eliminating the QStash network hop (saves 300-1000ms).
//   4. Pre-creation validation: ENDED/UNKNOWN states are checked before the task
//      is created, avoiding a create-then-delete DB round-trip.
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

    if (!walletId) {
      return NextResponse.json({ error: 'No wallet found. Add a wallet in Settings before queuing a mint.' }, { status: 400 });
    }
    if (!collectionId && !mintUrl) {
      return NextResponse.json({ error: 'Mint URL or contract address is required.' }, { status: 400 });
    }

    // ── Resolve URL → contract address ───────────────────────────────────────
    // FIX 1: Two-tier resolution. resolveMintIntent handles OpenSea, block
    // explorers, and URLs with an address in the path. For custom mint sites
    // (unknown host, no address in URL), we fall back to discoverMintRequirements
    // which scrapes the page via Jina/Firecrawl/Browserbase to extract the
    // contract. This makes "paste any URL" work for third-party mint pages.
    //
    // FIX 2: The discovery result is cached in `discoveryCache` and reused for
    // price/timing/phase later — no redundant scraping calls.
    let discoveryCache: Awaited<ReturnType<typeof discoverMintRequirements>> | null = null;

    if (mintUrl) {
      let intent = await resolveMintIntent(mintUrl);

      // Tier 2 fallback: if URL resolution didn't find a contract, scrape the page
      if (!intent.contractAddress) {
        logger.info('resolveMintIntent found no contract — falling back to page scraping', { area: 'mints/route', url: mintUrl });
        try {
          discoveryCache = await discoverMintRequirements(mintUrl);
          if (discoveryCache.contractAddress) {
            intent = {
              ...intent,
              contractAddress: discoveryCache.contractAddress,
              chain: discoveryCache.chain ?? intent.chain,
              collectionName: discoveryCache.collectionName ?? intent.collectionName,
              isValid: true,
              confidence: discoveryCache.confidence,
              sourcePlatform: 'custom',
            };
          }
        } catch (err) {
          logger.warn('Discovery fallback failed', { area: 'mints/route', error: err instanceof Error ? err.message : String(err) });
        }
      }

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

    // Load the collection record for on-chain queries
    const [collection] = await getDb()
      .select()
      .from(collections)
      .where(and(eq(collections.id, collectionId), eq(collections.userId, authResult.userId)))
      .limit(1);

    if (!collection) {
      return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
    }

    // ── Parallel: mint state + on-chain requirements ─────────────────────────
    const [mintState, requirements] = await Promise.all([
      getMintState(collection.contractAddress, collection.chain),
      fetchMintRequirements(collection.contractAddress, collection.chain),
    ]);

    // ── FIX 5: Pre-creation state validation ─────────────────────────────────
    // Check ENDED and UNKNOWN BEFORE creating the task to avoid a wasteful
    // create-then-delete DB round-trip.

    if (mintState.status === 'ENDED') {
      return NextResponse.json(
        { error: 'This mint has already ended and is no longer mintable.' },
        { status: 422 },
      );
    }

    // ── Phase 0: proof-gated detection ──────────────────────────────────────
    // Allowlist / claim-with-proof / signed-voucher / token-id mints need data
    // AutoMint cannot generate yet (there is no proof source). fetchMintRequirements
    // flags these by storing an `unsupported:<fn>` sentinel in mintFunction. Reject
    // here — BEFORE creating a task and scheduling QStash — with a clear message,
    // instead of letting the task fail with a late on-chain revert inside the
    // webhook execution. This keeps the "paste → clear feedback" contract honest
    // until proof-based minting lands (Phase 1).
    if (isUnsupportedMintFunction(requirements.mintFunction)) {
      const fnName = (requirements.mintFunction ?? '').replace(UNSUPPORTED_MINT_PREFIX, '') || 'allowlist/claim';
      return NextResponse.json(
        {
          error:
            `This collection's mint function (${fnName}) needs data AutoMint can't generate yet — ` +
            'typically an allowlist Merkle proof, a signed voucher, claim conditions, or a token id. ' +
            "Proof-based WL/allowlist minting isn't supported yet, so this mint would revert on-chain. " +
            'Please mint it manually for now.',
          code: 'PROOF_REQUIRED',
        },
        { status: 422 },
      );
    }

    // FIX 2 (continued): Run discovery ONCE for UNKNOWN state recovery AND
    // price/timing/phase — reuse the cached result from URL resolution if
    // we already have it.
    if (mintState.status === 'UNKNOWN' || mintState.status === 'NOT_STARTED') {
      if (!discoveryCache && mintUrl) {
        discoveryCache = await discoverMintRequirements(mintUrl, {
          contractAddress: collection.contractAddress,
          chain: collection.chain,
        }).catch(() => null);
      }
    }

    if (mintState.status === 'UNKNOWN') {
      if (discoveryCache) {
        if (discoveryCache.mintStartTime && discoveryCache.mintStartTime.getTime() > Date.now()) {
          Object.assign(mintState, { status: 'NOT_STARTED' as const, startTime: discoveryCache.mintStartTime });
        } else if (discoveryCache.contractAddress) {
          Object.assign(mintState, { status: 'LIVE' as const });
        }
      }

      if (mintState.status === 'UNKNOWN') {
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

    // ── Now safe to create the task (state is LIVE or NOT_STARTED) ────────────
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

    // ── Resolve price (on-chain preferred, discovery fallback) ────────────────
    // FIX 6: Use the already-fetched discoveryCache for price fallback instead
    // of calling discoverMintRequirements again.
    let resolvedPrice: string | null = requirements.mintPrice;
    if (resolvedPrice == null) {
      resolvedPrice = discoveryCache?.mintPrice ?? collection.mintPrice ?? null;
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

    // ── NOT_STARTED (upcoming): schedule for mint start time ─────────────────
    if (mintState.status === 'NOT_STARTED') {
      if (wlMode) {
        // Use discoveryCache (already fetched above) for WL phases
        const nonPublicPhases = (discoveryCache?.mintPhases ?? []).filter((p: MintPhase) => p.type !== 'public');
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

      // Use discoveryCache for start time instead of re-calling discovery
      if (!detectedStart && discoveryCache?.mintStartTime) {
        detectedStart = discoveryCache.mintStartTime;
        logger.info('Discovery provided startTime', { area: 'mints/route', startTime: detectedStart.toISOString() });
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
    if (wlMode) {
      // Use discoveryCache for WL phases (already fetched or null)
      const allPhases = discoveryCache?.mintPhases ?? [];
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
        await addTaskLog(task.id, 'mint_state_live', 'success', 'WL mint is LIVE — executing immediately');
        // Speed fix: execute inline instead of round-tripping through QStash.
        const { mintResult, finalTask } = await executeMintInline(task.id, authResult.userId);
        return NextResponse.json(
          {
            task: finalTask ?? { id: task.id },
            collection,
            mintStatus: mintResult.success ? 'completed' : 'failed',
            autoTriggered: true,
            wlPhase: wlPhase.type,
            success: mintResult.success,
            txHash: mintResult.txHash,
            error: mintResult.success ? undefined : mintResult.error,
          },
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

    // ── Public live mint — execute inline (no QStash round trip) ──
    // Speed fix: previously this dispatched through scheduleMint() → QStash
    // publish → Upstash queue → webhook delivery, adding ~300ms-1.5s of pure
    // network/queue latency before execution even started. Since the mint is
    // confirmed LIVE right now and we're already inside a serverless
    // invocation with budget to spare (maxDuration: 10s vs. our ~0.5-1.5s
    // execution pipeline), we execute directly and return the REAL result —
    // success with txHash, or a clear failure reason — in this same response.
    await addTaskLog(task.id, 'mint_state_live', 'success', 'Mint is LIVE on-chain — executing immediately');
    await getDb()
      .update(mintTasks)
      .set({ phase: 'public', updatedAt: new Date() })
      .where(eq(mintTasks.id, task.id));

    const { mintResult, finalTask } = await executeMintInline(task.id, authResult.userId);

    return NextResponse.json(
      {
        task: finalTask ?? { id: task.id },
        collection,
        mintStatus: mintResult.success ? 'completed' : 'failed',
        autoTriggered: true,
        success: mintResult.success,
        txHash: mintResult.txHash,
        error: mintResult.success ? undefined : mintResult.error,
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

    // H-1 fix: route through QStash instead of calling executeMintTask() inline.
    // Inline execution is capped at this route's 10s Vercel maxDuration, which is
    // shorter than Ethereum's ~12s block time. That kills the function mid-receipt-
    // wait on every retry, leaving the task stuck in 'running' until recovery picks
    // it up ~90s later. scheduleMint dispatches immediately (scheduledTime = now,
    // initialStatus = 'ready') giving execution a fresh invocation budget — exactly
    // the same path as the normal POST flow after M4.
    const scheduledTask = await scheduleMint({
      taskId: body.id,
      userId: authResult.userId,
      scheduledTime: new Date(),
      initialStatus: 'ready',
    });

    if (!('id' in scheduledTask)) {
      return NextResponse.json({ error: 'Task not found or already completed' }, { status: 404 });
    }

    return NextResponse.json({ task: scheduledTask, queued: true });
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
