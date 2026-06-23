import { getDb } from '@/lib/db';
import { mintTasks } from '@/drizzle/schema';
import { and, eq } from 'drizzle-orm';
import type { MintRequirements } from './mint-requirements.service';
import type { MintState } from './mint-state.service';

export interface PreArmConfig {
  userId: string;
  walletId: string;
  contractAddress: string;
  chain: string;
  quantity: number;
  requirements: MintRequirements;
  mintState: MintState;
}

export async function preArmMint(config: PreArmConfig) {
  const { userId, walletId, contractAddress, quantity, requirements } = config;

  // M-1 fix: wrap SELECT + INSERT in a DB transaction with a row-level lock.
  // Without this, two concurrent calls (e.g. Telegram webhook + copy-mint)
  // for the same (userId, contractAddress) both pass the existence check and
  // both INSERT — producing duplicate tasks and a potential double-mint.
  // FOR UPDATE on the SELECT serialises concurrent callers at the DB level.
  return getDb().transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(mintTasks)
      .where(and(eq(mintTasks.contractAddress, contractAddress), eq(mintTasks.userId, userId)))
      .limit(1)
      .for('update');

    if (existing[0]) return existing[0];

    const [task] = await tx.insert(mintTasks).values({
      userId,
      walletId,
      quantity,
      status: 'pending',
      contractAddress,
      mintFunction: requirements.mintFunction,
      mintPrice: requirements.mintPrice,
    }).returning();
    return task;
  });
}
