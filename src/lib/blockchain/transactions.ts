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
 * Wait for transaction confirmation using viem's native waitForTransactionReceipt.
 *
 * Replaces the previous manual while-loop that called getTransactionStatus() every
 * 500ms. viem handles the polling internally using the same pollingInterval, but:
 *   - No manual event-loop blocking via setTimeout chains
 *   - Built-in timeout handling (throws WaitForTransactionReceiptTimeoutError)
 *   - Cleaner abort on confirmed/reverted receipts
 *
 * Behaviour on timeout: returns { status: 'pending' } so callers treat the tx
 * as unconfirmed, identical to the previous implementation.
 */
export async function waitForConfirmation(
  chain: string,
  txHash: string,
  maxWaitMs = 90_000,       // 90s max wait
  pollIntervalMs = 500,     // 500ms polling — detects confirmation within one cycle
): Promise<TransactionInfo> {
  try {
    const client = getClient(chain);
    const receipt = await client.waitForTransactionReceipt({
      hash: txHash as Hex,
      timeout: maxWaitMs,
      pollingInterval: pollIntervalMs,
    });

    const status: TxStatus = receipt.status === 'success' ? 'confirmed' : 'failed';
    return {
      hash: txHash,
      status,
      blockNumber: receipt.blockNumber ? Number(receipt.blockNumber) : undefined,
      from: receipt.from,
      to: receipt.to ?? undefined,
      gasUsed: receipt.gasUsed?.toString(),
    };
  } catch (error) {
    // Timeout or network error — return pending so callers treat it as unconfirmed
    captureException(error, {
      area: 'transactions',
      context: { txHash, chain },
      fingerprint: ['transactions', 'wait-timeout'],
    });
    return { hash: txHash, status: 'pending' };
  }
}
