import { getDb } from '@/lib/db';
import { wallets, mintTasks } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { getMintState } from './mint-state.service';
import { fetchMintRequirements } from './mint-requirements.service';
import type { FastMintWallet } from './mint-fast.service';
import { preArmMint } from './mint-prearm.service';
import { startMintRace } from './mint-race.service';

export type OrchestratorAction = 'EXECUTED' | 'SCHEDULED' | 'FAILED';
export interface OrchestratorResult { action: OrchestratorAction; txHash?: string; taskId?: string; error?: string; }

async function loadWallet(walletId: string, userId: string) {
  const [wallet] = await getDb().select().from(wallets).where(and(eq(wallets.id, walletId), eq(wallets.userId, userId))).limit(1);
  return wallet;
}

export async function handleMintUrl(url: string, walletId: string, userId: string, quantity = 1): Promise<OrchestratorResult> {
  const intent = await resolveMintIntent(url);
  if (!intent.isValid || !intent.contractAddress) {
    return { action: 'FAILED' as const, error: 'Could not resolve mint contract from URL: ' + url };
  }
  const wallet = await loadWallet(walletId, userId);
  if (!wallet) {
    return { action: 'FAILED' as const, error: 'Wallet not found' };
  }
  const [existing] = await getDb().select().from(mintTasks).where(and(eq(mintTasks.contractAddress, intent.contractAddress), eq(mintTasks.status, 'completed'))).limit(1);
  if (existing?.txHash) {
    return { action: 'EXECUTED', txHash: existing.txHash, taskId: existing.id };
  }
  const state = await getMintState(intent.contractAddress, intent.chain);
  const requirements = await fetchMintRequirements(intent.contractAddress, intent.chain);
  const fastWallet: FastMintWallet = { id: wallet.id, address: wallet.address, chain: wallet.chain, encryptedPrivateKey: wallet.encryptedPrivateKey, userId: wallet.userId };
  if (state.status === 'LIVE') {
    const race = await startMintRace(fastWallet, intent.contractAddress, intent.chain, quantity, userId);
    if (race.success && race.txHash) {
      return { action: 'EXECUTED', txHash: race.txHash };
    }
    return { action: 'FAILED' as const, error: race.error };
  }
  if (state.status === 'NOT_STARTED') {
    const task = await preArmMint({ userId, walletId: wallet.id, contractAddress: intent.contractAddress, chain: intent.chain, quantity, requirements, mintState: state });
    return { action: 'SCHEDULED', taskId: task.id };
  }
  if (state.status === 'ENDED') {
    return { action: 'FAILED' as const, error: 'This mint has already ended' };
  }
  const [task] = await getDb().insert(mintTasks).values({ userId, walletId: wallet.id, quantity, status: 'pending' as const, contractAddress: intent.contractAddress }).returning();
  return { action: 'SCHEDULED', taskId: task.id };
}
