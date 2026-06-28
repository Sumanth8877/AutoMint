import 'server-only';

import { getDb } from '@/lib/db';
import { wallets, mintTasks } from '@/drizzle/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { getMintState } from './mint-state.service';
import { fetchMintRequirements } from './mint-requirements.service';
import { scheduleMint } from './qstash.service';
import { discoverMintRequirements } from '@/lib/services/mint-discovery.service';
import { acquireCronLock, releaseCronLock } from '@/lib/redis/lock';

// C3 fix: serialize the check-then-insert critical section per (user, contract)
// so two near-simultaneous creation requests (e.g. duplicate Telegram messages)
// cannot both pass the "does an active task already exist?" check and create
// duplicate tasks — which would schedule two QStash messages and mint twice.
//
// This is intentionally NOT a DB unique constraint: mint-fanout legitimately
// creates multiple tasks for one contract across different wallets, and
// instant-mint creates one task per phase. A (userId, contractAddress) unique
// index would break those flows and silently drop legitimate tasks.
const TASK_CREATE_LOCK_TTL = 30;        // seconds — auto-expires on crash
const TASK_CREATE_LOCK_RETRIES = 25;    // ~3s max wait (25 * 120ms)
const TASK_CREATE_LOCK_RETRY_MS = 120;

/**
 * Run `fn` while holding a short per-(user, contract) creation lock.
 *
 * A second caller for the same (user, contract) waits up to ~3s for the first
 * to finish inserting, then runs `fn` itself — by which point its dedup SELECT
 * will see the row the first caller created and return it.
 *
 * Fail-open: if Redis is unavailable the lock cannot be acquired and `fn` runs
 * unserialized (same behaviour as before this fix) rather than blocking mints.
 */
export async function withMintTaskCreationLock<T>(
  userId: string,
  contractAddress: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockName = `create-mint-task:${userId}:${contractAddress.toLowerCase()}`;
  let token: string | null = null;
  for (let i = 0; i < TASK_CREATE_LOCK_RETRIES && !token; i++) {
    token = await acquireCronLock(lockName, TASK_CREATE_LOCK_TTL);
    if (!token) await new Promise((resolve) => setTimeout(resolve, TASK_CREATE_LOCK_RETRY_MS));
  }
  try {
    return await fn();
  } finally {
    if (token) await releaseCronLock(lockName, token);
  }
}

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

  // Narrow to a non-null const so it stays `string` inside the closure below
  // (TS resets property narrowing of intent.contractAddress across function boundaries).
  const contractAddress = intent.contractAddress;

  // C3 fix: serialize dedup-check + insert per (user, contract) so concurrent
  // creation requests cannot both miss the dedup check and create duplicate tasks.
  return withMintTaskCreationLock(userId, contractAddress, async (): Promise<OrchestratorResult> => {
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
        eq(mintTasks.contractAddress, contractAddress),
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
    getMintState(contractAddress, intent.chain),
    fetchMintRequirements(contractAddress, intent.chain),
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
    contractAddress: contractAddress,
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
      contractAddress: contractAddress,
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
  });
}
