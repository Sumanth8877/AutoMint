import { getClient } from './client';
import type { Hex } from 'viem';
import { captureException } from '@/lib/observability/sentry';

export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface TransactionInfo {
  hash: string;
  status: TxStatus;
  blockNumber?: number;
  confirmations?: number;
  from?: string;
  to?: string;
  gasUsed?: string;
}

/**
 * Get transaction status by hash.
 *
 * C-2 fix: uses getTransactionReceipt instead of getTransaction.
 *
 * getTransaction only tells us whether a tx is in a block — it does NOT
 * distinguish between a successful mint and a reverted one. Both have a
 * blockNumber, so the old code returned 'confirmed' for reverts.
 *
 * getTransactionReceipt exposes receipt.status:
 *   'success' → confirmed and executed successfully
 *   'reverted' → included in a block but execution failed (out-of-gas, require())
 *   null/undefined → not yet mined (still pending)
 *
 * This means 'failed' is now reachable, and waitForConfirmation will correctly
 * exit early on reverted transactions instead of polling for the full timeout.
 */
export async function getTransactionStatus(chain: string, txHash: string): Promise<TransactionInfo> {
  try {
    const client = getClient(chain);
    const receipt = await client.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);

    // Receipt not yet available → still pending (not mined)
    if (!receipt) {
      return { hash: txHash, status: 'pending' };
    }

    const blockNumber = receipt.blockNumber ? Number(receipt.blockNumber) : undefined;

    // receipt.status is 'success' | 'reverted' per EIP-658 (post-Byzantium)
    const status: TxStatus = receipt.status === 'success' ? 'confirmed' : 'failed';

    return {
      hash: txHash,
      status,
      blockNumber,
      from: receipt.from,
      to: receipt.to ?? undefined,
      gasUsed: receipt.gasUsed?.toString(),
    };
  } catch (error) {
    captureException(error, { area: 'transactions', context: { txHash, chain }, fingerprint: ['transactions', 'status-error'] });
    return { hash: txHash, status: 'pending' };
  }
}

/**
 * Wait for transaction confirmation (polling-based).
 * Returns the transaction info once confirmed or failed.
 */
export async function waitForConfirmation(
  chain: string,
  txHash: string,
  maxWaitMs = 90_000,        // Speed fix: reduced from 120s to 90s
  pollIntervalMs = 500,      // Speed fix: reduced from 5000ms to 500ms
  // 500ms polling detects confirmation within one poll cycle after the block lands.
  // On Base (2s blocks): avg detection latency drops from ~5s to ~500-2500ms.
  // On Ethereum (12s blocks): drops from ~5s to ~500-1000ms after inclusion.
): Promise<TransactionInfo> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const info = await getTransactionStatus(chain, txHash);
    if (info.status === 'confirmed' || info.status === 'failed') {
      return info;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { hash: txHash, status: 'pending' };
}
