import 'server-only';

import { getDb } from '@/lib/db';
import { wallets, mintTasks } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { getMintState } from './mint-state.service';
import { fetchMintRequirements } from './mint-requirements.service';
import { scheduleMint } from './qstash.service';

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

  // 3. Deduplication: return the existing completed task if the user
  //    already minted this contract successfully
  const [existing] = await getDb()
    .select()
    .from(mintTasks)
    .where(
      and(
        eq(mintTasks.contractAddress, intent.contractAddress),
        eq(mintTasks.userId, userId),
        eq(mintTasks.status, 'completed'),
      ),
    )
    .limit(1);
  if (existing?.txHash) {
    return { action: 'TASK_CREATED', taskId: existing.id };
  }

  // 4. Resolve mint state and requirements in parallel
  const [mintState, requirements] = await Promise.all([
    getMintState(intent.contractAddress, intent.chain),
    fetchMintRequirements(intent.contractAddress, intent.chain),
  ]);

  if (mintState.status === 'ENDED') {
    return { action: 'FAILED', error: 'This mint has already ended' };
  }

  // 5. Create the task record
  //    status 'pending': mint is not live yet — monitoring engine will wait
  //    status 'ready':   mint is live now — execution engine will start soon
  const initialStatus = mintState.status === 'LIVE' ? 'ready' : 'pending';
  const [task] = await getDb()
    .insert(mintTasks)
    .values({
      userId,
      walletId: wallet.id,
      quantity,
      status: initialStatus,
      contractAddress: intent.contractAddress,
      mintFunction: requirements.mintFunction,
      mintPrice: requirements.mintPrice,
      scheduledTime:
        mintState.status !== 'LIVE' && mintState.startTime
          ? mintState.startTime
          : undefined,
      maxRetries: 20,
    })
    .returning();

  // 6. Schedule via QStash
  //    For LIVE mints: schedule for near-immediate delivery (5 seconds)
  //    For future mints: schedule for the known start time, or 60 s from now
  const scheduledTime =
    mintState.status === 'LIVE'
      ? new Date(Date.now() + 5_000)
      : mintState.startTime && mintState.startTime.getTime() > Date.now()
        ? mintState.startTime
        : undefined;

  await scheduleMint({ taskId: task.id, userId, scheduledTime });

  const action: OrchestratorAction =
    mintState.status === 'LIVE' ? 'TASK_CREATED' : 'MONITORING';

  return { action, taskId: task.id };
}
