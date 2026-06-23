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
  // C-1 fix: scope the lookup to this user only.
  // Without the userId predicate, any task for the same contractAddress across
  // ALL users would be returned, causing cross-user wallet execution.
  const [existing] = await getDb()
    .select()
    .from(mintTasks)
    .where(and(eq(mintTasks.contractAddress, contractAddress), eq(mintTasks.userId, userId)))
    .limit(1);
  if (existing) return existing;

  const [task] = await getDb().insert(mintTasks).values({
    userId,
    walletId,
    quantity,
    status: 'pending',
    contractAddress,
    mintFunction: requirements.mintFunction,
    mintPrice: requirements.mintPrice,
  }).returning();
  return task;
}
