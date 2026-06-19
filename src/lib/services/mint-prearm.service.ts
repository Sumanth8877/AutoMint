import { getDb } from '@/lib/db';
import { mintTasks } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { fetchMintRequirements } from './mint-requirements.service';
import { getMintState } from './mint-state.service';

export interface PreArmConfig {
  userId: string;
  walletId: string;
  contractAddress: string;
  chain: string;
  quantity: number;
  requirements: any;
  mintState: any;
}

export async function preArmMint(config: PreArmConfig) {
  const { userId, walletId, contractAddress, chain, quantity, requirements, mintState } = config;
  const idempotencyKey = 'prearm:' + walletId + ':' + contractAddress;
  const [existing] = await getDb().select().from(mintTasks).where(eq(mintTasks.contractAddress, contractAddress)).limit(1);
  if (existing) return existing;

  const executeAt = mintState.startTime || new Date(Date.now() + 60000);
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
