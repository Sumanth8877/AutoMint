import 'server-only'; // reliability: r1-r5

import { getDb } from '@/lib/db';
import { mintTasks, wallets } from '@/drizzle/schema';
import { eq, and, isNull, isNotNull, lt, inArray } from 'drizzle-orm';
import { addBreadcrumb, captureException, captureMessage } from '@/lib/observability/sentry';
import { getClient } from '@/lib/blockchain/client';

// Tasks stuck in 'running' longer than this are assumed to have crashed
const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface RecoveryResult {
  checkedAt: string;
  stuckFound: number;
  preBroadcastRecovered: number;  // had no txHash — safe to re-execute
  postBroadcastRecovered: number; // had txHash — routed to receipt recheck
  errors: number;
}

/**
 * Scan for and recover stuck mint tasks.
 *
 * Two failure modes exist when a serverless function crashes mid-execution:
 *
 * Mode A — crashed BEFORE broadcast (txHash IS NULL):
 *   The transaction was never sent. Re-execution is safe.
 *   Action: reset status to 'ready', re-schedule via QStash.
 *
 * Mode B — crashed DURING receipt wait (txHash IS NOT NULL):
 *   The transaction IS on-chain (or in mempool). Re-execution would double-spend.
 *   Action: transition to 'unconfirmed', schedule receipt recheck.
 *
 * Both paths use updatedAt < now-10min to avoid touching tasks that are
 * legitimately executing (slow but not crashed).
 */
export async function recoverStuckMintTasks(): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    checkedAt: new Date().toISOString(),
    stuckFound: 0,
    preBroadcastRecovered: 0,
    postBroadcastRecovered: 0,
    errors: 0,
  };

  const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

  try {
    // C1 fix: also scan 'unconfirmed' tasks. With the post-broadcast txHash
    // persistence, a function killed during the receipt wait leaves the task in
    // 'unconfirmed' (txHash set) rather than 'running'. If the in-process receipt
    // recheck was never scheduled (the function died before returning), these
    // would otherwise be stranded. Routing stale ones to receipt recheck is safe
    // (idempotent poll, never re-broadcasts).
    const stuckTasks = await getDb()
      .select()
      .from(mintTasks)
      .where(
        and(
          inArray(mintTasks.status, ['running', 'unconfirmed']),
          lt(mintTasks.updatedAt, threshold),
        ),
      )
      .limit(25); // Safety cap — process at most 25 per run

    result.stuckFound = stuckTasks.length;

    if (stuckTasks.length === 0) return result;

    addBreadcrumb({
      category: 'recovery',
      message: `Recovery scan: ${stuckTasks.length} stuck task(s) found`,
      level: 'warning',
      data: { count: stuckTasks.length, threshold: threshold.toISOString() },
    });

    for (const task of stuckTasks) {
      try {
        if (!task.txHash) {
          await recoverPreBroadcastTask(task);
          result.preBroadcastRecovered++;
        } else {
          await recoverPostBroadcastTask(task.id, task.txHash);
          result.postBroadcastRecovered++;
        }
      } catch (err) {
        result.errors++;
        await captureException(err, {
          area: 'recovery',
          context: { taskId: task.id, hasTxHash: !!task.txHash },
          fingerprint: ['recovery', 'task-error'],
        });
      }
    }

    const total = result.preBroadcastRecovered + result.postBroadcastRecovered;
    if (total > 0) {
      await captureMessage('Stuck mint task recovery completed', {
        area: 'recovery',
        level: 'info',
        context: { ...result },
        fingerprint: ['recovery', 'completed'],
      });
    }
  } catch (error) {
    await captureException(error, {
      area: 'recovery',
      context: {},
      fingerprint: ['recovery', 'scan-failed'],
    });
  }

  return result;
}

// ─── Mode A: crashed before broadcast ─────────────────────────────────────────
// No txHash means the transaction was never sent.
// Reset to 'ready' and re-schedule via QStash for immediate re-execution.

async function recoverPreBroadcastTask(task: typeof mintTasks.$inferSelect): Promise<void> {
  const taskId = task.id;
  const userId = task.userId;

  // H3 defense-in-depth: a task reaches here only with txHash IS NULL, which
  // normally means the transaction was never broadcast. But there is a tiny
  // residual window (between broadcastRawTransaction returning and the onBroadcast
  // txHash persist) where a transaction WAS sent yet no hash was recorded.
  // Re-executing then would double-spend. Before re-executing, verify on-chain
  // that the wallet has no transaction in flight beyond its confirmed nonce.
  if (task.walletId) {
    try {
      const [wallet] = await getDb().select().from(wallets).where(eq(wallets.id, task.walletId)).limit(1);
      if (wallet) {
        const client = getClient(wallet.chain);
        const addr = wallet.address as `0x${string}`;
        const [latest, pending] = await Promise.all([
          client.getTransactionCount({ address: addr, blockTag: 'latest' }),
          client.getTransactionCount({ address: addr, blockTag: 'pending' }),
        ]);
        if (Number(pending) > Number(latest)) {
          // A transaction from this wallet is sitting in the mempool — a mint
          // broadcast may be in flight for this task. Do NOT re-execute; defer to
          // the next recovery cycle (the mempool clears within minutes). Erring
          // toward a delayed retry is strictly safer than a double-spend.
          await captureMessage('Recovery deferred — wallet has an in-flight transaction; not re-executing to avoid double-spend', {
            area: 'recovery',
            level: 'warning',
            context: { taskId, walletId: task.walletId, latest: Number(latest), pending: Number(pending) },
            fingerprint: ['recovery', 'inflight-defer'],
          });
          return;
        }
      }
    } catch (nonceErr) {
      // Could not verify on-chain state — be conservative and skip re-execution
      // this cycle (a later cycle retries once RPC recovers). Avoids re-broadcast
      // when we cannot prove the wallet is idle.
      await captureException(nonceErr, {
        area: 'recovery',
        context: { taskId, walletId: task.walletId },
        fingerprint: ['recovery', 'nonce-check-failed'],
      });
      return;
    }
  }

  // Atomic update: only succeeds if the task is STILL in running+no-txHash state.
  // Prevents racing with a concurrent legitimate execution that just finished.
  const [reset] = await getDb()
    .update(mintTasks)
    .set({ status: 'ready', updatedAt: new Date() })
    .where(
      and(
        eq(mintTasks.id, taskId),
        eq(mintTasks.status, 'running'),
        isNull(mintTasks.txHash),
      ),
    )
    .returning();

  if (!reset) {
    // Another worker already claimed/resolved this task — skip
    addBreadcrumb({
      category: 'recovery',
      message: 'Pre-broadcast recovery skipped — task already resolved',
      level: 'info',
      data: { taskId },
    });
    return;
  }

  // Re-schedule immediately via QStash
  const { scheduleMint } = await import('@/lib/services/qstash.service');
  await scheduleMint({ taskId, userId });

  addBreadcrumb({
    category: 'recovery',
    message: 'Pre-broadcast stuck task recovered — rescheduled for execution',
    level: 'info',
    data: { taskId, userId },
  });
}

// ─── Mode B: crashed during receipt wait ──────────────────────────────────────
// txHash is known — transaction may be on-chain. Must NOT re-execute.
// Transition to 'unconfirmed' and schedule a receipt recheck.

async function recoverPostBroadcastTask(taskId: string, txHash: string): Promise<void> {
  const [transitioned] = await getDb()
    .update(mintTasks)
    .set({ status: 'unconfirmed', updatedAt: new Date() })
    .where(
      and(
        eq(mintTasks.id, taskId),
        // C1 fix: a stuck task with a txHash may be in 'running' (crashed before
        // the post-broadcast persist completed its status flip) or already
        // 'unconfirmed' (persisted, but the receipt recheck was never scheduled).
        inArray(mintTasks.status, ['running', 'unconfirmed']),
        isNotNull(mintTasks.txHash),
      ),
    )
    .returning();

  if (!transitioned) {
    addBreadcrumb({
      category: 'recovery',
      message: 'Post-broadcast recovery skipped — task already resolved',
      level: 'info',
      data: { taskId },
    });
    return;
  }

  // Route to the existing receipt recheck pipeline
  const { scheduleReceiptRecheck } = await import('@/lib/services/qstash.service');
  await scheduleReceiptRecheck(taskId, txHash);

  addBreadcrumb({
    category: 'recovery',
    message: 'Post-broadcast stuck task recovered — routing to receipt recheck',
    level: 'info',
    data: { taskId, txHash },
  });
}
