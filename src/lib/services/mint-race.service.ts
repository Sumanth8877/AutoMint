import { executeMintFast, type FastMintWallet } from './mint-fast.service';
import { getMintState } from './mint-state.service';

export interface RaceResult {
  success: boolean;
  txHash?: string;
  error?: string;
  stopped: boolean;
}

const MAX_RETRIES = 25;
const BASE_DELAY_MS = 200;

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export async function startMintRace(wallet: FastMintWallet, contractAddress: string, chain: string, quantity: number, userId: string): Promise<RaceResult> {
  void quantity;
  let retries = 0;

  while (retries < MAX_RETRIES) {
    const state = await getMintState(contractAddress, chain);
    if (state.status !== 'LIVE') {
      return { success: false, error: 'Mint no longer live', stopped: true };
    }

    const result = await executeMintFast(
      { contractAddress, chain, sourceUrl: '', isValid: true, confidence: 1, sourcePlatform: 'contract' },
      wallet,
      userId
    );

    if (result.success && result.txHash) {
      return { success: true, txHash: result.txHash, stopped: true };
    }

    if (!result.error || !isRetryable(result.error)) {
      return { success: false, error: result.error, stopped: true };
    }

    retries++;
    const delay = BASE_DELAY_MS * 2 ** retries;
    await sleep(delay);
  }

  return { success: false, error: 'Max retries exceeded', stopped: true };
}

function isRetryable(err: string): boolean {
  const retryable = ['RPC', 'timeout', 'network', 'gas', 'nonce', 'underpriced', '429', '503'];
  return retryable.some(k => err.toLowerCase().includes(k));
}
