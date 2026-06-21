import { getDb } from '@/lib/db';
import { mintTasks, wallets, collections, mintHistory } from '@/drizzle/schema';
import { desc, eq, and, inArray } from 'drizzle-orm';
import { simulateMint, estimateMintGas, executeMint, getMintMode, type MintParams } from '@/lib/blockchain/mint';
import { logActivity } from '@/lib/monitoring';
import { sendTelegramNotification } from '@/lib/services/telegram.service';
import { sendMintFailedEmail, sendMintScheduledEmail, sendMintSuccessEmail, sendSystemErrorEmail } from '@/lib/services/email-notification.service';
import { requireRiskApproval } from '@/lib/services/risk.service';
import { addBreadcrumb, captureException, captureMessage, startSpan } from '@/lib/observability/sentry';
import { acquireLock, releaseLock } from '@/lib/services/mint-lock.service';
import type { Hex } from 'viem';

export async function getUserMintTasks(userId: string) {
  const result = await getDb().select().from(mintTasks).where(eq(mintTasks.userId, userId)).orderBy(desc(mintTasks.createdAt));
  return result;
}

export async function addMintTask(userId: string, data: { walletId: string; collectionId: string; quantity: number; chain?: string; safeModeEnabled?: boolean }) {
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
  userId?: string,
  options: { existingLockToken?: string } = {},
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  return startSpan('mint.execute_task', { area: 'minting', taskId, userId }, async () => {
  const mintLock = options.existingLockToken
    ? { acquired: true, mintId: taskId, key: `mint-lock:${taskId}`, token: options.existingLockToken }
    : await acquireLock(taskId);
  if (!mintLock.acquired) {
    return { success: false, error: 'Mint execution already locked' };
  }

  try {
  const riskGate = await requireRiskApproval({ taskId, action: 'mint', userId });
  if (!riskGate.approved) {
    return {
      success: false,
      error: `Risk approval required: ${riskGate.risk?.riskScore ?? 0}/100`,
    };
  }

  const claimWhere = userId
    ? and(
        eq(mintTasks.id, taskId),
        eq(mintTasks.userId, userId),
        inArray(mintTasks.status, ['pending', 'monitoring', 'ready', 'failed']),
      )
    : and(
        eq(mintTasks.id, taskId),
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

  await logActivity(claimed.userId, 'mint_status_changed', 'Mint task started', { taskId, status: 'running' });
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

  const [wallet] = await getDb().select().from(wallets).where(eq(wallets.id, claimed.walletId)).limit(1);
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

  // Always simulate first to catch obvious failures
  const gas = await estimateMintGas(wallet.address as Hex, chain, params);
  if (gas.error) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
    await captureMessage('Gas estimation failed', {
      area: 'minting',
      level: 'error',
      context: { userId: claimed.userId, taskId, walletId: claimed.walletId, wallet: wallet.address, collection: claimed.collectionId ?? undefined, chain },
      extra: { error: gas.error, contractAddress: claimed.contractAddress },
      fingerprint: ['mint', 'gas-estimation'],
    });
    await sendTelegramNotification(claimed.userId, 'mint_failed', {
      taskId,
      contractAddress: claimed.contractAddress,
      error: gas.error,
    });
    await sendMintFailedEmail(claimed.userId, {
      taskId,
      contractAddress: claimed.contractAddress,
      error: gas.error,
    });
    await sendSystemErrorEmail(claimed.userId, {
      taskId,
      title: 'Wallet Execution Error',
      error: gas.error,
    });
    return { success: false, error: gas.error };
  }

  const sim = await simulateMint(wallet.address as Hex, chain, params);
  if (!sim.success) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
    await captureMessage('Mint simulation failed', {
      area: 'minting',
      level: 'error',
      context: { userId: claimed.userId, taskId, walletId: claimed.walletId, wallet: wallet.address, collection: claimed.collectionId ?? undefined, chain },
      extra: { error: sim.error, contractAddress: claimed.contractAddress },
      fingerprint: ['mint', 'simulation'],
    });
    await sendTelegramNotification(claimed.userId, 'mint_failed', {
      taskId,
      contractAddress: claimed.contractAddress,
      error: sim.error,
    });
    await sendMintFailedEmail(claimed.userId, {
      taskId,
      contractAddress: claimed.contractAddress,
      error: sim.error,
    });
    await sendSystemErrorEmail(claimed.userId, {
      taskId,
      title: 'Mint Simulation Error',
      error: sim.error,
    });
    return { success: false, error: sim.error };
  }

  const mode = getMintMode();
  let result;

  if (mode !== 'live') {
    // ── SIMULATION ONLY ─────────────────────────────
    result = {
      success: true,
      txHash: undefined as string | undefined,
      gasUsed: undefined,
      blockNumber: undefined,
    };
  } else {
    // ── LIVE: execute real transaction ──────────────
    result = await executeMint(wallet.address as Hex, chain, params);

    if (!result.success) {
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
      await sendSystemErrorEmail(claimed.userId, {
        taskId,
        title: 'Mint Transaction Error',
        error: result.error,
      });
      return { success: false, error: result.error };
    }
  }

  const now = new Date();
  await getDb().update(mintTasks)
    .set({ status: 'completed', txHash: result.txHash || null, confirmedAt: result.txHash ? now : null, updatedAt: now })
    .where(eq(mintTasks.id, taskId));

  if (result.txHash) {
    await getDb().insert(mintHistory).values({
      userId: claimed.userId,
      walletId: claimed.walletId,
      collectionId: claimed.collectionId,
      status: 'pending',
      transactionHash: result.txHash,
      gasUsed: result.gasUsed || undefined,
      blockNumber: result.blockNumber?.toString() || undefined,
      confirmedAt: result.blockNumber ? now : undefined,
    });
  }

  if (claimed.userId) {
    await logActivity(claimed.userId, 'task_completed', result.txHash ? 'Mint executed' : 'Mint simulated', {
      taskId,
      walletId: claimed.walletId,
      collectionId: claimed.collectionId,
      txHash: result.txHash,
      chain,
      mode,
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
  }

  addBreadcrumb({
    category: 'mint',
    message: 'mint completed',
    level: 'info',
    data: { taskId, userId: claimed.userId, txHash: result.txHash, chain, mode },
  });

  return { success: true, txHash: result.txHash };
  } finally {
    await releaseLock(taskId, mintLock.token);
  }
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
  const [task] = await getDb()
    .select()
    .from(mintTasks)
    .where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId)))
    .limit(1);

  return task ?? null;
}

export async function updateMintTaskStatus(
  id: string,
  userId: string,
  status: 'pending' | 'monitoring' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled',
) {
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
