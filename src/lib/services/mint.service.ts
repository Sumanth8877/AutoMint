import { getDb } from '@/lib/db';
import { mintTasks, users, wallets, collections, mintHistory } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { simulateMint, estimateMintGas, executeMint, type MintParams } from '@/lib/blockchain/mint';
import { logActivity } from '@/lib/monitoring';

export async function getUserMintTasks(userId: string) {
  const result = await getDb().select().from(mintTasks).where(eq(mintTasks.userId, userId)).orderBy(mintTasks.createdAt);
  return result;
}

export async function addMintTask(userId: string, data: { walletId: string; collectionId: string; quantity: number; chain?: string }) {
  const user = await getDb().select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (user.length === 0) throw new Error('User not found');

  const [wallet] = await getDb().select().from(wallets).where(and(eq(wallets.id, data.walletId), eq(wallets.userId, user[0].id))).limit(1);
  if (!wallet) throw new Error('Wallet not found');

  const [collection] = await getDb().select().from(collections).where(and(eq(collections.id, data.collectionId), eq(collections.userId, user[0].id))).limit(1);
  if (!collection) throw new Error('Collection not found');

  const [task] = await getDb().insert(mintTasks).values({
    userId: user[0].id,
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
  const [task] = await getDb().select().from(mintTasks).where(eq(mintTasks.id, taskId)).limit(1);
  if (!task) throw new Error(`Mint task not found: ${taskId}`);

  if (task.txHash) {
    return { success: true, txHash: task.txHash };
  }

  if (!task.walletId || !task.contractAddress) {
    throw new Error('Mint task missing wallet or contract');
  }

  const [wallet] = await getDb().select().from(wallets).where(eq(wallets.id, task.walletId)).limit(1);
  if (!wallet) throw new Error('Wallet not found for mint task');

  const chain = wallet.chain;
  const params: MintParams = {
    contractAddress: task.contractAddress as any,
    mintFunction: task.mintFunction || undefined,
    mintPrice: task.mintPrice || undefined,
    gasLimit: task.gasLimit || undefined,
    quantity: task.quantity,
  };

  const gas = await estimateMintGas(wallet.address as any, chain, params);

  const sim = await simulateMint(wallet.address as any, chain, params);
  if (!sim.success) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
    return { success: false, error: sim.error };
  }

  const result = await executeMint(wallet.address as any, chain, params, true);

  if (!result.success) {
    await getDb().update(mintTasks).set({ status: 'failed', updatedAt: new Date() }).where(eq(mintTasks.id, taskId));
    return { success: false, error: result.error };
  }

  const now = new Date();
  await getDb().update(mintTasks)
    .set({ status: 'completed', txHash: result.txHash || null, confirmedAt: result.txHash ? now : null, updatedAt: now })
    .where(eq(mintTasks.id, taskId));

  if (result.txHash) {
    await getDb().insert(mintHistory).values({
      userId: task.userId,
      walletId: task.walletId,
      collectionId: task.collectionId,
      status: 'pending',
      transactionHash: result.txHash,
      gasUsed: result.gasUsed || undefined,
      blockNumber: result.blockNumber?.toString() || undefined,
      confirmedAt: result.blockNumber ? now : undefined,
    });
  }

  if (task.userId) {
    await logActivity(task.userId, 'task_completed', result.txHash ? 'Mint executed' : 'Mint simulated', {
      taskId,
      walletId: task.walletId,
      collectionId: task.collectionId,
      txHash: result.txHash,
      chain,
    });
  }

  return { success: true, txHash: result.txHash };
}

export async function removeMintTask(id: string, userId: string) {
  const existing = await getDb().select().from(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId))).limit(1);
  if (existing.length === 0) throw new Error('Task not found');

  await getDb().delete(mintTasks).where(and(eq(mintTasks.id, id), eq(mintTasks.userId, userId)));
  return { success: true };
}
