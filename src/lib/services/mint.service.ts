import { getDb } from '@/lib/db';
import { mintTasks, wallets, collections, mintHistory, taskLogs } from '@/drizzle/schema';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { executeMint, type MintParams } from '@/lib/blockchain/mint';
import { logActivity } from '@/lib/monitoring';
import { sendTelegramNotification } from '@/lib/services/telegram.service';
import { sendMintFailedEmail, sendMintScheduledEmail, sendMintSuccessEmail, sendSystemErrorEmail } from '@/lib/services/email-notification.service';
import type { GasStrategy } from '@/lib/services/execution-settings.service';
import { requireRiskApproval } from '@/lib/services/risk.service';
import { addBreadcrumb, captureException, captureMessage, startSpan } from '@/lib/observability/sentry';
import { acquireLock, releaseLock } from '@/lib/services/mint-lock.service';
import type { Hex } from 'viem';
import { unregisterIfIdle } from '@/lib/services/alchemy-webhook.service';

export async function getUserMintTasks(userId: string) {
  const result = await getDb().select().from(mintTasks).where(eq(mintTasks.userId, userId)).orderBy(desc(mintTasks.createdAt));

  // Attach the REAL execution failure reason from task logs.
  // mintTasks.riskReasons holds risk-analysis notes (e.g. "wallet has no
  // confirmed mint history") — NOT the execution error. Showing those as the
  // failure reason is misleading (a balance failure displayed as a risk note).
  // We pull the most recent error-level task log per failed task instead.
  const failedIds = result.filter((t) => t.status === 'failed').map((t) => t.id);
  if (failedIds.length === 0) {
    return result.map((t) => ({ ...t, failureReason: null as string | null }));
  }

  const errorLogs = await getDb()
    .select({ taskId: taskLogs.taskId, message: taskLogs.message, createdAt: taskLogs.createdAt })
    .from(taskLogs)
    .where(and(inArray(taskLogs.taskId, failedIds), eq(taskLogs.status, 'error')))
    .orderBy(desc(taskLogs.createdAt));

  const reasonByTask = new Map<string, string>();
  for (const log of errorLogs) {
    if (log.message && !reasonByTask.has(log.taskId)) reasonByTask.set(log.taskId, log.message);
  }

  return result.map((t) => ({ ...t, failureReason: reasonByTask.get(t.id) ?? null }));
}

export async function addMintTask(userId: string, data: {
  walletId: string;
  collectionId: string;
  quantity: number;
  chain?: string;
  safeModeEnabled?: boolean;
  gasStrategy?: GasStrategy;
  maxRetries?: number;
  riskThreshold?: number;
}) {
  const [wallet] = await getDb().select().from(wallets).where(and(eq(wallets.id, data.walletId), eq(wallets.userId, userId))).limit(1);
  if (!wallet) throw new Error('Wallet not found');
  if (wallet.walletType !== 'EVM') throw new Error('Only EVM wallets can be used for mint tasks');

  const [collection] = await getDb().select().from(collections).where(and(eq(collections.id, data.collectionId), eq(collections.userId, userId))).limit(1);
  if (!collection) throw new Error('Collection not found');

  const [task] = await getDb().insert(mintTasks).values({
    userId,
    walletId: data.walletId,
    collectionId: data.collectionId,
    quantity: data.quantity,
    status: 'pending',
    contractAddress: collection.contractAddress,
    mintPrice: collection.mintPrice || undefined,
    gasLimit: undefined,
    safeModeEnabled: data.safeModeEnabled ?? false,
    gasStrategy: data.gasStrategy ?? 'STANDARD',
    maxRetries: data.maxRetries ?? 25,
    riskThreshold: data.riskThreshold ?? 75,
  }).returning();

  await logActivity(userId, 'task_created', 'Mint task created', {
    taskId: task.id,
    walletId: task.walletId,
    collectionId: task.collectionId,
    contractAddress: task.contractAddress,
  });

  await sendTelegramNotification(userId, 'mint_scheduled', {
    taskId: task.id,
    contractAddress: task.contractAddress || undefined,
  });
  await sendMintScheduledEmail(userId, {
    taskId: task.id,
    contractAddress: task.contractAddress || undefined,
  });

  return task;
}

export async function executeMintTask(
  taskId: string,
  userId: string,
  options: { existingLockToken?: string; privateMempool?: boolean } = {},
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  // Validate that taskId is a UUID, not a contract address
  if (!taskId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    return { success: false, error: 'Invalid task ID format. Expected UUID, got contract address.' };
  }

  return startSpan('mint.execute_task', { area: 'minting', taskId, userId }, async (): Promise<{ success: boolean; txHash?: string; error?: string }> => {
  const mintLockToken = options.existingLockToken ?? null;
  const lockAcquired = options.existingLockToken ? true : await acquireLock(taskId);
  if (!lockAcquired) {
    return { success: false, error: 'Mint execution already locked' };
  }
  // Derive the token for release: provided externally or unknown (plain DEL fallback)
  const lockToken: string | undefined = mintLockToken ?? undefined;

  try {
  const riskGate = await requireRiskApproval({ taskId, action: 'mint', userId });
  if (!riskGate.approved) {
    return {
      success: false,
      error: `Risk approval required: ${riskGate.risk?.riskScore ?? 0}/100`,
    };
  }

  // H-4 fix: userId is now required (not optional). Ownership check is always enforced.
  const claimWhere = and(
    eq(mintTasks.id, taskId),
    eq(mintTasks.userId, userId),
    inArray(mintTasks.status, ['pending', 'monitoring', 'ready', 'failed']),
  );
  // ── Atomic claim: only a 'pending' task can be claimed ─────────
  const [claimed] = await getDb()
    .update(mintTasks)
    .set({
      status: 'running',
      updatedAt: new Date(),
    })
    .where(claimWhere)
    .returning();

  if (!claimed) {
    return { success: false, error: 'Task not found, already running, or completed' };
  }

  void logActivity(claimed.userId, 'mint_status_changed', 'Mint task started', { taskId, status: 'running' }); // fire-and-forget: non-critical logging must not block mint execution
  addBreadcrumb({
    category: 'mint',
    message: 'mint started',
    level: 'info',
    data: { taskId, userId: claimed.userId, walletId: claimed.walletId, collectionId: claimed.collectionId, chain: claimed.contractAddress },
  });
  await sendTelegramNotification(claimed.userId, 'mint_started', {
    taskId,
    contractAddress: claimed.contractAddress || undefined,
  });

  if (claimed.txHash) {
    return { success: true, txHash: claimed.txHash };
  }

  if (!claimed.walletId || !claimed.contractAddress) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
    await captureMessage('Mint task missing wallet or contract', {
      area: 'minting',
      level: 'error',
      context: { userId: claimed.userId, taskId, walletId: claimed.walletId ?? undefined, collection: claimed.collectionId ?? undefined },
      fingerprint: ['mint', 'missing-wallet-contract'],
    });
    await sendTelegramNotification(claimed.userId, 'mint_failed', {
      taskId,
      error: 'Mint task missing wallet or contract',
    });
    await sendMintFailedEmail(claimed.userId, {
      taskId,
      error: 'Mint task missing wallet or contract',
    });
    await sendSystemErrorEmail(claimed.userId, {
      taskId,
      title: 'Mint Task Configuration Error',
      error: 'Mint task missing wallet or contract',
    });
    return { success: false, error: 'Mint task missing wallet or contract' };
  }

  const [wallet] = await getDb().select().from(wallets).where(and(eq(wallets.id, claimed.walletId), eq(wallets.userId, claimed.userId))).limit(1);
  if (!wallet) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
    await captureMessage('Wallet not found for mint task', {
      area: 'minting',
      level: 'error',
      context: { userId: claimed.userId, taskId, walletId: claimed.walletId },
      fingerprint: ['mint', 'wallet-not-found'],
    });
    await sendTelegramNotification(claimed.userId, 'mint_failed', {
      taskId,
      contractAddress: claimed.contractAddress,
      error: 'Wallet not found for mint task',
    });
    await sendMintFailedEmail(claimed.userId, {
      taskId,
      contractAddress: claimed.contractAddress,
      error: 'Wallet not found for mint task',
    });
    await sendSystemErrorEmail(claimed.userId, {
      taskId,
      title: 'Wallet Execution Error',
      error: 'Wallet not found for mint task',
    });
    return { success: false, error: 'Wallet not found for mint task' };
  }

  const chain = wallet.chain;
  const params: MintParams = {
    contractAddress: claimed.contractAddress as Hex,
    mintFunction: claimed.mintFunction || undefined,
    mintPrice: claimed.mintPrice || undefined,
    gasLimit: claimed.gasLimit || undefined,
    quantity: claimed.quantity,
  };

  const result = await executeMint(wallet.address as Hex, chain, params, claimed.userId, { 
      walletId: wallet.id,
      // Auto-enable Flashbots Protect for Ethereum mainnet — prevents frontrunning at no cost.
      // User can force-disable via options.privateMempool = false (e.g. if Flashbots latency
      // is unacceptable for high-speed mint races where speed > protection).
      privateMempool: options.privateMempool ?? (chain === 'ethereum'),
      // C1 fix: persist txHash to the DB the instant the tx is broadcast, before the
      // receipt wait. If the function is killed mid-wait the task already has a txHash,
      // so recoverStuckMintTasks routes it to receipt-recheck (Mode B) and NEVER
      // re-broadcasts a second transaction.
      onBroadcast: async (txHash) => {
        await getDb()
          .update(mintTasks)
          .set({ status: 'unconfirmed', txHash, updatedAt: new Date() })
          .where(eq(mintTasks.id, taskId));
      },
    });

  if (!result.success) {
      // C-04: If txHash is present the transaction was broadcast but receipt
      // tracking failed (e.g. timeout). Transition to 'unconfirmed' and schedule
      // a receipt recheck.  DO NOT mark as 'failed' — that would allow a retry
      // to call sendTransaction again and broadcast a second transaction.
      if (result.txHash) {
        await getDb()
          .update(mintTasks)
          .set({ status: 'unconfirmed', txHash: result.txHash, updatedAt: new Date() })
          .where(eq(mintTasks.id, taskId));
        await captureMessage('Mint receipt tracking failed — task is unconfirmed', {
          area: 'minting',
          level: 'warning',
          context: { userId: claimed.userId, taskId, walletId: claimed.walletId, wallet: wallet.address, chain, transactionHash: result.txHash },
          extra: { error: result.error, contractAddress: claimed.contractAddress },
          fingerprint: ['mint', 'receipt-timeout'],
        });
        const { scheduleReceiptRecheck } = await import('@/lib/services/qstash.service');
        await scheduleReceiptRecheck(taskId, result.txHash);
        return { success: false, txHash: result.txHash, error: 'unconfirmed' };
      }

      await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
      await captureMessage('Mint transaction failed', {
        area: 'minting',
        level: 'error',
        context: { userId: claimed.userId, taskId, walletId: claimed.walletId, wallet: wallet.address, collection: claimed.collectionId ?? undefined, chain },
        extra: { error: result.error, contractAddress: claimed.contractAddress },
        fingerprint: ['mint', 'transaction-failed'],
      });
      await sendTelegramNotification(claimed.userId, 'mint_failed', {
        taskId,
        contractAddress: claimed.contractAddress,
        error: result.error,
      });
      await sendMintFailedEmail(claimed.userId, {
        taskId,
        contractAddress: claimed.contractAddress,
        error: result.error,
      });
      // Cleanup: mint failed — unregister from Alchemy webhook if no other tasks watch this contract
      if (claimed.contractAddress) {
        void unregisterIfIdle(claimed.contractAddress, taskId).catch(() => {});
      }
      await sendSystemErrorEmail(claimed.userId, {
        taskId,
        title: 'Mint Transaction Error',
        error: result.error,
      });
      return { success: false, error: result.error };
  }

  const now = new Date();
  await getDb().transaction(async (tx) => {
    await tx.update(mintTasks)
      .set({ status: 'completed', txHash: result.txHash || null, confirmedAt: result.txHash ? now : null, updatedAt: now })
      .where(eq(mintTasks.id, taskId));

    if (result.txHash) {
      await tx.insert(mintHistory).values({
        userId: claimed.userId,
        walletId: claimed.walletId,
        collectionId: claimed.collectionId,
        status: 'pending',
        transactionHash: result.txHash,
        idempotencyKey: `mint:${taskId}:${result.txHash}`,
        gasUsed: result.gasUsed || undefined,
        blockNumber: result.blockNumber?.toString() || undefined,
        confirmedAt: result.blockNumber ? now : undefined,
      }).onConflictDoNothing();

      if (claimed.collectionId) {
        await tx.update(collections)
          .set({
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(collections.id, claimed.collectionId));
      }
    }
  });

  if (claimed.userId) {
    void logActivity(claimed.userId, 'task_completed', 'Mint executed', {
      taskId,
      walletId: claimed.walletId,
      collectionId: claimed.collectionId,
      txHash: result.txHash,
      chain,
    });
    await sendTelegramNotification(claimed.userId, 'mint_success', {
      taskId,
      contractAddress: claimed.contractAddress,
      txHash: result.txHash,
    });
    await sendMintSuccessEmail(claimed.userId, {
      taskId,
      contractAddress: claimed.contractAddress,
      txHash: result.txHash,
    });
    // Cleanup: mint completed — unregister from Alchemy webhook if no other tasks watch this contract
    if (claimed.contractAddress) {
      void unregisterIfIdle(claimed.contractAddress, taskId).catch(() => {});
    }
  }

  addBreadcrumb({
    category: 'mint',
    message: 'mint completed',
    level: 'info',
    data: { taskId, userId: claimed.userId, txHash: result.txHash, chain },
  });

  return { success: true, txHash: result.txHash };
  } finally {
    await releaseLock(taskId, lockToken);
  }
  return { success: false, error: 'Mint execution did not complete' };
  }).catch(async (error) => {
    if (userId) {
      await sendSystemErrorEmail(userId, {
        taskId,
        title: 'Mint Execution Error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await captureException(error, {
      area: 'minting',
      context: { userId, taskId },
      fingerprint: ['mint', 'execute-task'],
    });
    throw error;
  });
}

export async function removeMintTask(id: string, userId: string) {
  const [existing] = await getDb().select().from(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId))).limit(1);
  if (!existing) throw new Error('Task not found');

  await getDb().delete(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId)));
  return { success: true };
}

export async function getMintTaskById(id: string, userId: string) {
  // Validate that id is a UUID, not a contract address
  if (!id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
    throw new Error('Invalid task ID format. Expected UUID.');
  }

  const [task] = await getDb()
    .select()
    .from(mintTasks)
    .where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId)))
    .limit(1);

  return task ?? null;
}

// H-01 Fix: mint task status state machine.
// task.service.ts contains a full state machine (VALID_TRANSITIONS) but is
// scaffolded and not yet wired into the live mint execution path.
// This guard provides the same protection inline for mintTask statuses,
// preventing impossible transitions (e.g. completed → running) that could
// cause double-spend or silent task corruption.
const VALID_MINT_TRANSITIONS: Record<string, string[]> = {
  pending:     ['monitoring', 'ready', 'running', 'failed', 'cancelled'],
  monitoring:  ['ready', 'running', 'failed', 'cancelled'],
  ready:       ['running', 'failed', 'cancelled'],
  running:     ['completed', 'failed', 'unconfirmed', 'cancelled'],
  unconfirmed: ['completed', 'failed'],
  completed:   [],   // terminal
  failed:      ['ready', 'cancelled'],
  cancelled:   [],   // terminal
};

function assertValidMintTransition(from: string, to: string, taskId: string): void {
  const allowed = VALID_MINT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `Invalid mint task status transition: ${from} → ${to} (taskId=${taskId}). ` +
      `Allowed from '${from}': [${allowed.join(', ') || 'none — terminal state'}]`,
    );
  }
}

export async function updateMintTaskStatus(
  id: string,
  userId: string,
  status: 'pending' | 'monitoring' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled',
) {
  // Fetch current status to validate the transition before writing.
  const [current] = await getDb()
    .select({ status: mintTasks.status })
    .from(mintTasks)
    .where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId)))
    .limit(1);

  if (!current) throw new Error('Task not found');
  assertValidMintTransition(current.status, status, id);

  const [task] = await getDb()
    .update(mintTasks)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId)))
    .returning();

  if (!task) throw new Error('Task not found');

  if (status === 'running') {
    await logActivity(userId, 'mint_status_changed', 'Mint task started', { taskId: id, status });
    await sendTelegramNotification(userId, 'mint_started', {
      taskId: id,
      contractAddress: task.contractAddress || undefined,
    });
  }

  if (status === 'cancelled') {
    await logActivity(userId, 'task_cancelled', 'Mint task cancelled', { taskId: id, status });
  }

  return task;
}
