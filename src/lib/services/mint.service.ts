import { getDb } from '@/lib/db';
import { mintTasks, wallets, collections, mintHistory } from '@/drizzle/schema';
import { desc, eq, and } from 'drizzle-orm';
import { simulateMint, estimateMintGas, executeMint, getMintMode, type MintParams } from '@/lib/blockchain/mint';
import { logActivity } from '@/lib/monitoring';
import type { Hex } from 'viem';

export async function getUserMintTasks(userId: string) {
  const result = await getDb().select().from(mintTasks).where(eq(mintTasks.userId, userId)).orderBy(desc(mintTasks.createdAt));
  return result;
}

export async function addMintTask(userId: string, data: { walletId: string; collectionId: string; quantity: number; chain?: string }) {
  const [wallet] = await getDb().select().from(wallets).where(and(eq(wallets.id, data.walletId), eq(wallets.userId, userId))).limit(1);
  if (!wallet) throw new Error('Wallet not found');

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
  }).returning();

  return task;
}

export async function executeMintTask(taskId: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  // ── Atomic claim: only a 'pending' task can be claimed ─────────
  const [claimed] = await getDb()
    .update(mintTasks)
    .set({
      status: 'running',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mintTasks.id, taskId),
        eq(mintTasks.status, 'pending'),
      ),
    )
    .returning();

  if (!claimed) {
    return { success: false, error: 'Task not found or already claimed' };
  }

  if (claimed.txHash) {
    return { success: true, txHash: claimed.txHash };
  }

  if (!claimed.walletId || !claimed.contractAddress) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
    return { success: false, error: 'Mint task missing wallet or contract' };
  }

  const [wallet] = await getDb().select().from(wallets).where(eq(wallets.id, claimed.walletId)).limit(1);
  if (!wallet) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
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
    return { success: false, error: gas.error };
  }

  const sim = await simulateMint(wallet.address as Hex, chain, params);
  if (!sim.success) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
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
  }

  return { success: true, txHash: result.txHash };
}

export async function removeMintTask(id: string, userId: string) {
  const [existing] = await getDb().select().from(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId))).limit(1);
  if (!existing) throw new Error('Task not found');

  await getDb().delete(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId)));
  return { success: true };
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
  }

  if (status === 'cancelled') {
    await logActivity(userId, 'task_cancelled', 'Mint task cancelled', { taskId: id, status });
  }

  return task;
}
