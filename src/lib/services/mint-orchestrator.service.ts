import 'server-only';

import { getDb } from '@/lib/db';
import { wallets, mintTasks } from '@/drizzle/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { getMintState } from './mint-state.service';
import { fetchMintRequirements } from './mint-requirements.service';
import { scheduleMint } from './qstash.service';
import { discoverMintRequirements } from '@/lib/services/mint-discovery.service';

// ——— Result types ——————————————————————————————————————————————————

export type OrchestratorAction = 'TASK_CREATED' | 'MONITORING' | 'FAILED';

export interface OrchestratorResult {
  action: OrchestratorAction;
  taskId?: string;
  error?: string;
}

// ——— Internal helpers —————————————————————————————————————————————

async function loadWallet(walletId: string, userId: string) {
  const [wallet] = await getDb()
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)))
    .limit(1);
  return wallet ?? null;
}

// ——— Public API ——————————————————————————————————————————————————

/**
 * createMintTaskFromUrl
 *
 * Creates a mint task from a URL and enqueues it via QStash.
 * Never executes a blockchain transaction. Never waits for a receipt.
 * Safe to call from a Telegram webhook handler.
 *
 * Returns immediately once the task is persisted and scheduled.
 * All execution, monitoring, retry, and confirmation happens through
 * the QStash → /api/webhooks/qstash → executeScheduledMint pipeline.
 */
export async function createMintTaskFromUrl(
  url: string,
  walletId: string,
  userId: string,
  quantity = 1,
): Promise<OrchestratorResult> {
  // 1. Resolve the mint intent from the URL
  const intent = await resolveMintIntent(url);
  if (!intent.isValid || !intent.contractAddress) {
    return {
      action: 'FAILED',
      error: 'Could not resolve mint contract from URL: ' + url,
    };
  }

  // 2. Validate wallet ownership
  const wallet = await loadWallet(walletId, userId);
  if (!wallet) {
    return { action: 'FAILED', error: 'Wallet not found' };
  }

  // 3. Deduplication: return the existing task if any active or completed task
  //    already exists for this user+contract pair.
  //    M-5 fix: previously only checked 'completed' — a second call while a task
  //    was 'pending' or 'running' would create a duplicate task and schedule
  //    an extra QStash message, causing double Telegram notifications and extra cost.
  const [existing] = await getDb()
    .select()
    .from(mintTasks)
    .where(
      and(
        eq(mintTasks.contractAddress, intent.contractAddress),
        eq(mintTasks.userId, userId),
        inArray(mintTasks.status, ['pending', 'monitoring', 'ready', 'running', 'completed']),
      ),
    )
    .limit(1);
  if (existing) {
    return { action: 'TASK_CREATED', taskId: existing.id };
  }

  // 4. Resolve mint state and on-chain requirements in parallel
  const [mintState, onChainRequirements] = await Promise.all([
    getMintState(intent.contractAddress, intent.chain),
    fetchMintRequirements(intent.contractAddress, intent.chain),
  ]);

  if (mintState.status === 'ENDED') {
    return { action: 'FAILED', error: 'This mint has already ended.' };
  }

  // 4b. Tiered discovery: fill any gaps left by on-chain RPC.
  //
  //     Pass everything we already know from Tier 1 (resolveMintIntent +
  //     fetchMintRequirements + getMintState) so the discovery service only
  //     escalates to Jina/Firecrawl/Browserbase for fields that are still missing.
  const discovered = await discoverMintRequirements(url, {
    contractAddress: intent.contractAddress,
    chain: intent.chain,
    collectionName: intent.collectionName,
    mintFunction: onChainRequirements.mintFunction,
    mintPrice: onChainRequirements.mintPrice ?? undefined,
    maxPerWallet: onChainRequirements.maxPerWallet,
    maxPerTx: onChainRequirements.maxPerTx,
    mintStartTime: mintState.startTime ?? onChainRequirements.mintStartTime ?? undefined,
    mintEndTime: mintState.endTime ?? onChainRequirements.mintEndTime ?? undefined,
  });

  // Merge: on-chain values win; discovery fills gaps
  const mintFunction = onChainRequirements.mintFunction ?? discovered.mintFunction ?? 'mint';
  const mintPrice = onChainRequirements.mintPrice ?? discovered.mintPrice ?? '0';
  const _maxPerWallet = onChainRequirements.maxPerWallet ?? discovered.maxPerWallet;
  const _maxPerTx = onChainRequirements.maxPerTx ?? discovered.maxPerTx;
  const mintStartTime = mintState.startTime ?? onChainRequirements.mintStartTime ?? discovered.mintStartTime ?? undefined;
  const _mintEndTime = mintState.endTime ?? onChainRequirements.mintEndTime ?? discovered.mintEndTime ?? undefined;

  if (discovered.missingFields.length > 0) {
    console.warn(
      '[orchestrator] createMintTaskFromUrl — fields still unresolved after all tiers:',
      discovered.missingFields, '— proceeding with best-effort values',
    );
  }

  // 5. Create the task record with fully enriched requirements
  const initialStatus = mintState.status === 'LIVE' ? 'ready' : 'pending';
  const [task] = await getDb()
    .insert(mintTasks)
    .values({
      userId,
      walletId: wallet.id,
      quantity,
      status: initialStatus,
      contractAddress: intent.contractAddress,
      mintFunction,
      mintPrice,
      scheduledTime: mintState.status !== 'LIVE' && mintStartTime ? mintStartTime : undefined,
      maxRetries: 20,
      // maxPerWallet/maxPerTx not stored in mintTasks table — used at execution time
    })
    .returning();

  // 6. Schedule via QStash
  //
  // IMPORTANT: fire-and-forget (void executeMintTask()) does NOT work on Vercel
  // serverless — the function is terminated when the HTTP response is sent.
  // QStash sends a separate HTTP request which runs as its own invocation.
  const scheduledTime =
    mintState.status === 'LIVE'
      ? new Date()
      : mintStartTime && mintStartTime.getTime() > Date.now()
      ? mintStartTime
      : undefined;

  await scheduleMint({
    taskId: task.id,
    userId,
    scheduledTime,
    initialStatus: mintState.status === 'LIVE' ? 'ready' : 'monitoring',
  });

  const action: OrchestratorAction = mintState.status === 'LIVE' ? 'TASK_CREATED' : 'MONITORING';

  return { action, taskId: task.id };
}
