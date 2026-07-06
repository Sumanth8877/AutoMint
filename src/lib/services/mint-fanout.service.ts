import 'server-only';

import { getDb } from '@/lib/db';
import { mintTasks, wallets } from '@/drizzle/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { getMintState } from '@/lib/services/mint-state.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { scheduleMint } from '@/lib/services/qstash.service';
import { getWalletBalancesMulticall } from '@/lib/blockchain/wallet';
import { estimatePreFlightGasBufferEth } from '@/lib/blockchain/gas';
import { logActivity } from '@/lib/monitoring';

export interface FanoutWalletResult {
  walletId: string;
  walletAddress: string;
  taskId: string;
  status: 'scheduled' | 'skipped' | 'error';
  reason?: string;
}

export interface FanoutResult {
  contractAddress: string;
  chain: string;
  mintState: 'LIVE' | 'PENDING' | 'ENDED';
  totalWallets: number;
  scheduled: number;
  skipped: number;
  errors: number;
  wallets: FanoutWalletResult[];
}

export interface FanoutOptions {
  quantity?: number;
  privateMempool?: boolean;
  overrideRisk?: boolean;
  maxRetries?: number;
}

/**
 * Multi-wallet fanout mint coordinator.
 *
 * Creates and schedules N mint tasks simultaneously — one per wallet — for the
 * same contract. All QStash messages are fired in parallel with no delay,
 * maximising the chance that all wallets hit the same block.
 *
 * Use cases:
 *   - Whale-style mass minting across a wallet cluster
 *   - Testing mint execution across multiple funded wallets
 *   - Maximising allocation on high-demand drops
 *
 * Safety invariants:
 *   - Wallets must belong to userId (enforced by DB query)
 *   - Deduplication: if a wallet already has an active task for this contract, skip it
 *   - Each wallet has its own task and nonce — no shared state between wallets
 *   - If the mint has ended, all wallets are rejected cleanly
 */
export async function fanoutMintFromUrl(
  url: string,
  walletIds: string[],
  userId: string,
  options: FanoutOptions = {},
): Promise<FanoutResult> {
  const quantity = options.quantity ?? 1;

  // ── 1. Validate input ────────────────────────────────────────────────
  if (!walletIds.length || walletIds.length > 50) {
    throw new Error('Fanout requires 1–50 wallets');
  }

  // ── 2. Resolve mint intent once (shared for all wallets) ─────────────
  const intent = await resolveMintIntent(url);
  if (!intent.isValid || !intent.contractAddress) {
    throw new Error(`Could not resolve mint contract from URL: ${url}`);
  }

  // ── 3. Fetch mint state + requirements in parallel ───────────────────
  const [mintState, requirements] = await Promise.all([
    getMintState(intent.contractAddress, intent.chain),
    fetchMintRequirements(intent.contractAddress, intent.chain),
  ]);

  if (mintState.status === 'ENDED') {
    throw new Error('This mint has already ended');
  }

  // ── 4. Validate all wallets belong to userId ─────────────────────────
  const ownedWallets = await getDb()
    .select({ id: wallets.id, address: wallets.address })
    .from(wallets)
    .where(
      and(
        inArray(wallets.id, walletIds),
        eq(wallets.userId, userId),
        eq(wallets.walletType, 'EVM'),
      ),
    );

  const ownedMap = new Map(ownedWallets.map((w) => [w.id, w.address]));

  // ── 5. Check for existing active tasks per wallet (deduplication) ────
  const existingTasks = await getDb()
    .select({ walletId: mintTasks.walletId, id: mintTasks.id })
    .from(mintTasks)
    .where(
      and(
        eq(mintTasks.contractAddress, intent.contractAddress),
        eq(mintTasks.userId, userId),
        inArray(mintTasks.status, ['pending', 'monitoring', 'ready', 'running', 'completed']),
      ),
    );

  const existingWalletIds = new Set(existingTasks.map((t) => t.walletId).filter(Boolean));

  // ── 6. Build per-wallet results ───────────────────────────────────────
  const walletResults: FanoutWalletResult[] = [];
  const candidates: Array<{ walletId: string; walletAddress: string }> = [];

  for (const walletId of walletIds) {
    const walletAddress = ownedMap.get(walletId);

    if (!walletAddress) {
      walletResults.push({
        walletId,
        walletAddress: 'unknown',
        taskId: '',
        status: 'error',
        reason: 'Wallet not found or not owned by user',
      });
      continue;
    }

    if (existingWalletIds.has(walletId)) {
      const existing = existingTasks.find((t) => t.walletId === walletId);
      walletResults.push({
        walletId,
        walletAddress,
        taskId: existing?.id ?? '',
        status: 'skipped',
        reason: 'Active task already exists for this wallet and contract',
      });
      continue;
    }

    candidates.push({ walletId, walletAddress });
  }

  // Funding pre-check for every remaining candidate wallet, in ONE RPC
  // round-trip instead of one getBalance() call per wallet (fanout supports
  // up to 50 wallets — polling those individually is both slow, competing
  // against the mint window, and expensive on a metered RPC plan).
  // getWalletBalancesMulticall() batches all native-balance reads through
  // Multicall3's getEthBalance(address), which every supported chain has
  // deployed at the same address.
  const tasksToCreate: Array<{ walletId: string; walletAddress: string }> = [];

  if (candidates.length > 0) {
    const [balances, gasBufferEth] = await Promise.all([
      getWalletBalancesMulticall(candidates.map((c) => c.walletAddress), intent.chain),
      estimatePreFlightGasBufferEth(intent.chain, quantity),
    ]);
    const balanceByAddress = new Map(balances.map((b) => [b.address.toLowerCase(), b]));

    // mintPrice is `string | null` — if the price genuinely can't be
    // determined at this point, allow through (same policy as the
    // single-wallet check in qstash.service.ts): the real gate is
    // executeMint()'s pre-broadcast simulation.
    const mintPriceEth = requirements.mintPrice != null ? Number(requirements.mintPrice) : null;

    for (const candidate of candidates) {
      const balanceResult = balanceByAddress.get(candidate.walletAddress.toLowerCase());
      const balanceEth = balanceResult ? Number(balanceResult.balance) : 0;

      if (mintPriceEth != null && Number.isFinite(balanceEth)) {
        const requiredEth = mintPriceEth * quantity + gasBufferEth;
        if (balanceEth < requiredEth) {
          walletResults.push({
            walletId: candidate.walletId,
            walletAddress: candidate.walletAddress,
            taskId: '',
            status: 'skipped',
            reason: balanceResult?.error
              ? `Balance check failed: ${balanceResult.error}`
              : `Insufficient balance: have ${balanceEth.toFixed(5)}, need ~${requiredEth.toFixed(5)} (mint cost + gas)`,
          });
          continue;
        }
      }

      tasksToCreate.push(candidate);
    }
  }

  if (tasksToCreate.length === 0) {
    return buildResult(intent.contractAddress, intent.chain, mintState.status, walletIds.length, walletResults);
  }

  // ── 7. Batch-insert all task records ─────────────────────────────────
  const initialStatus = (mintState.status === 'LIVE' ? 'ready' : 'pending') as 'ready' | 'pending';
  const scheduledTime = mintState.status !== 'LIVE' && mintState.startTime
    ? mintState.startTime
    : undefined;

  const insertedTasks = await getDb()
    .insert(mintTasks)
    .values(
      tasksToCreate.map(({ walletId }) => ({
        userId,
        walletId,
        quantity,
        status: initialStatus,
        contractAddress: intent.contractAddress,
        mintFunction: requirements.mintFunction,
        mintPrice: requirements.mintPrice,
        scheduledTime,
        maxRetries: options.maxRetries ?? 20,
        overrideRiskFlag: options.overrideRisk ?? false,
      })),
    )
    .returning();

  // Build a walletId → taskId map from inserted tasks
  const taskMap = new Map(insertedTasks.map((t) => [t.walletId, t.id]));

  // ── 8. Schedule all tasks simultaneously ─────────────────────────────
  // Fire all QStash messages in parallel — this is the core of the fanout.
  // No Not-Before delay (live mints) or same scheduled time (future mints)
  // ensures all wallets receive their execution message at the same moment.
  const scheduleResults = await Promise.allSettled(
    tasksToCreate.map(({ walletId, walletAddress }) => {
      const taskId = taskMap.get(walletId);
      if (!taskId) return Promise.reject(new Error('Task not created'));

      return scheduleMint({ taskId, userId, scheduledTime, initialStatus: initialStatus === 'ready' ? 'ready' : 'monitoring' }).then(() => ({
        walletId,
        walletAddress,
        taskId,
        status: 'scheduled' as const,
      }));
    }),
  );

  // ── 9. Collect schedule results ────────────────────────────────────
  for (let i = 0; i < tasksToCreate.length; i++) {
    const { walletId, walletAddress } = tasksToCreate[i];
    const taskId = taskMap.get(walletId) ?? '';
    const result = scheduleResults[i];

    if (result.status === 'fulfilled') {
      walletResults.push({ walletId, walletAddress, taskId, status: 'scheduled' });
    } else {
      walletResults.push({
        walletId,
        walletAddress,
        taskId,
        status: 'error',
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  }

  await logActivity(userId, 'task_created', `Fanout mint scheduled — ${tasksToCreate.length} wallets`, {
    contractAddress: intent.contractAddress,
    chain: intent.chain,
    walletCount: tasksToCreate.length,
  });

  return buildResult(intent.contractAddress, intent.chain, mintState.status, walletIds.length, walletResults);
}

function buildResult(
  contractAddress: string,
  chain: string,
  mintStateStatus: string,
  totalWallets: number,
  walletResults: FanoutWalletResult[],
): FanoutResult {
  return {
    contractAddress,
    chain,
    mintState: mintStateStatus as 'LIVE' | 'PENDING' | 'ENDED',
    totalWallets,
    scheduled: walletResults.filter((r) => r.status === 'scheduled').length,
    skipped: walletResults.filter((r) => r.status === 'skipped').length,
    errors: walletResults.filter((r) => r.status === 'error').length,
    wallets: walletResults,
  };
}
