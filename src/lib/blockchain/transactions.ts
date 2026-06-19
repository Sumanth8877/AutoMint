import { getClient } from './client';

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
 */
export async function getTransactionStatus(chain: string, txHash: string): Promise<TransactionInfo> {
  try {
    const client = getClient(chain);
    const tx = await client.getTransaction({ hash: txHash as any });

    if (!tx) {
      return { hash: txHash, status: 'pending' };
    }

    const blockNumber = tx.blockNumber ? Number(tx.blockNumber) : undefined;
    const status = blockNumber ? 'confirmed' : 'pending';

    return {
      hash: txHash,
      status,
      blockNumber,
      from: tx.from,
      to: tx.to ?? undefined,
      gasUsed: tx.gas?.toString(),
    };
  } catch (error) {
    console.error(`getTransactionStatus error for ${txHash} on ${chain}:`, error);
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
  maxWaitMs = 120_000,
  pollIntervalMs = 5000,
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