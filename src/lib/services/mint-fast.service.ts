import 'server-only';

/**
 * executeMintFast(intent, wallet)
 *
 * FAST PATH mint execution — bypasses task queue entirely.
 *
 * Requirements:
 * - estimate gas
 * - sign transaction immediately via Viem
 * - broadcast on-chain
 * - return txHash
 * - enforce idempotency before execution
 * - write activity log + mint history on success
 * - fail safely: no partial writes without txHash
 *
 *
 * Security invariants (C-1):
 * - userId is derived from wallet.userId (always the owning user).
 * - The optional `activityUserId` parameter only affects activity-log writes;
 *   it does not affect key resolution or ownership validation.
 * - getDecryptedPrivateKey() enforces ownership at the DB layer.
 * - Error messages returned to callers are sanitised.
 */

import { getDb } from '@/lib/db';
import { mintHistory } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { estimateMintGas, type MintParams } from '@/lib/blockchain/mint';
import { getDecryptedPrivateKey } from './wallet.service';
import { logActivity } from '@/lib/monitoring';
import { getMintState } from './mint-state.service';
import { captureException } from '@/lib/observability/sentry';
import type { MintIntent } from '@/lib/resolve-mint-intent';
import type { Hex } from 'viem';

// ——— Types ——————————————————————————————————————————————————————————
import {
  allocateNonce,
  releaseInflightNonce,
  scanAndFillGaps,
} from '@/lib/services/nonce-allocator.service';

export interface FastMintWallet {
  id: string;
  address: string;
  chain: string;
  encryptedPrivateKey?: string | null;
  userId: string;  // always required — this is the owning user
}

export interface FastMintResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ——— Helpers ————————————————————————————————————————————————————————

function buildMintParams(intent: MintIntent): MintParams {
  return {
    contractAddress: intent.contractAddress as Hex,
    mintFunction: 'mint',
    quantity: 1,
  };
}

function buildIdempotencyKeyForIntent(intent: MintIntent, wallet: FastMintWallet): string {
  return `fast_mint:${wallet.id}:${intent.contractAddress}:${intent.chain}`;
}

// ——— Fast path executor ———————————————————————————————————————————

/**
 * Execute a mint immediately, bypassing the task queue.
 *
 * Preconditions:
 * - intent must be valid with contractAddress
 * - wallet must have an encryptedPrivateKey (imported wallet)
 *
 * Guarantees:
 * - Idempotency: returns existing txHash if already executed
 * - Fail-safe: if broadcast succeeds, DB writes always happen
 * - Ownership: key resolved only for wallet.userId — no cross-user access
 */
export async function executeMintFast(
  intent: MintIntent,
  wallet: FastMintWallet,
  activityUserId?: string,  // for activity log only; key resolution uses wallet.userId
): Promise<FastMintResult> {
  if (!intent.contractAddress) {
    return { success: false, error: 'Mint intent has no contract address' };
  }

  if (!wallet.encryptedPrivateKey) {
    return { success: false, error: 'Wallet does not have an imported private key' };
  }

  try {
    // —— 1. Idempotency check ——————————————————————————————————————
    const idempotencyKey = buildIdempotencyKeyForIntent(intent, wallet);

    const [existingHistory] = await getDb()
      .select()
      .from(mintHistory)
      .where(eq(mintHistory.idempotencyKey, idempotencyKey))
      .limit(1);

    if (existingHistory) {
      return {
        success: true,
        txHash: existingHistory.transactionHash || undefined,
      };
    }

    // —— 2. Verify mint is LIVE on-chain ———————————————————————————
    const mintState = await getMintState(intent.contractAddress, intent.chain);
    if (mintState.status !== 'LIVE') {
      return {
        success: false,
        error: `Mint is not live (status: ${mintState.status})`,
      };
    }

    // —— 3. Decrypt wallet key ———————————————————————————————————————
    // Ownership is enforced by getDecryptedPrivateKey(walletId, userId):
    // it only returns a key when wallets.id = wallet.id AND wallets.userId = wallet.userId.
    let privateKey: string;
    try {
      privateKey = await getDecryptedPrivateKey(wallet.id, wallet.userId);
    } catch (keyError) {
      await captureException(keyError, {
        area: 'minting',
        context: { chain: intent.chain, collection: intent.contractAddress },
        fingerprint: ['mint-fast', 'key-decryption'],
      });
      // Classify error safely: check for ownership/access-related messages.
      const OWNERSHIP_ERROR_PATTERNS = [
        'not found',
        'access denied',
        'unauthorized',
        'permission denied',
        'belongs to another user',
      ];
      const isOwnershipError =
        keyError instanceof Error &&
        OWNERSHIP_ERROR_PATTERNS.some((pattern) =>
          keyError.message.toLowerCase().includes(pattern),
        );
      return {
        success: false,
        error: isOwnershipError
          ? 'Wallet not found or access denied.'
          : 'Wallet key unavailable.',
      };
    }

    const { parseAbi, encodeFunctionData } = await import('viem');
    const { SUPPORTED_CHAINS } = await import('@/lib/blockchain/chains');
    const { parseEther } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { getWalletClient } = await import('@/lib/services/rpc-manager.service');

    const chainObj = SUPPORTED_CHAINS[intent.chain as keyof typeof SUPPORTED_CHAINS];
    if (!chainObj) {
      return { success: false, error: `Unsupported chain: ${intent.chain}` };
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const walletClient = getWalletClient(intent.chain, account, { userId: wallet.userId });

    // C-03 Fix: allocate unique nonce via Redis atomic INCR
    const nonceResult = await allocateNonce(account.address, intent.chain).catch(() => null);
    const allocatedNonce: number | undefined = nonceResult?.nonce;
    const mintParams = buildMintParams(intent);

    // —— 4. Estimate gas ———————————————————————————————————————————
    const gasResult = await estimateMintGas(wallet.address as `0x${string}`, intent.chain, mintParams, wallet.userId);
    if (gasResult.error) {
      return { success: false, error: `Gas estimation failed: ${gasResult.error}` };
    }

    // —— 5. Build transaction data ———————————————————————————————————
    const mintData = encodeFunctionData({
      abi: parseAbi(['function mint(uint256 quantity) payable']),
      functionName: 'mint',
      args: [BigInt(mintParams.quantity)],
    });

    const value = mintParams.mintPrice ? parseEther(mintParams.mintPrice) : BigInt(0);

    // —— 6. Broadcast transaction ——————————————————————————————————
    const txHash = await walletClient.sendTransaction({
      account,
      chain: chainObj,
      to: intent.contractAddress as `0x${string}`,
      data: mintData,
      value,
      gas: gasResult.gasLimit,
      // C-03: explicit nonce prevents concurrent workers from receiving the same nonce
      ...(allocatedNonce !== undefined && { nonce: allocatedNonce }),
    });

    // —— 7. Wait for confirmation ——————————————————————————————————
    const { getClient } = await import('@/lib/blockchain/client');
    const publicClient = getClient(intent.chain, wallet.userId);

    // Post-broadcast: release inflight tracking (non-blocking)
    if (allocatedNonce !== undefined) {
      void releaseInflightNonce(account.address, intent.chain, allocatedNonce).catch(() => undefined);
      void scanAndFillGaps(account.address, intent.chain).catch(() => undefined);
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== 'success') {
      return { success: false, error: 'Transaction reverted on-chain', txHash };
    }

    // —— 8. Persist mint history ———————————————————————————————————
    const now = new Date();
    await getDb().insert(mintHistory).values({
      userId: wallet.userId,
      walletId: wallet.id,
      status: 'confirmed',
      transactionHash: txHash,
      idempotencyKey,
      gasUsed: receipt.gasUsed?.toString(),
      blockNumber: receipt.blockNumber?.toString(),
      confirmedAt: now,
    });

    // —— 9. Activity log ———————————————————————————————————————————
    const logUserId = activityUserId || wallet.userId;
    await logActivity(logUserId, 'task_completed', 'Mint executed (fast path)', {
      taskId: undefined,
      walletId: wallet.id,
      collectionId: undefined,
      txHash,
      chain: intent.chain,
      sourcePlatform: intent.sourcePlatform,
      fastPath: true,
    });

    return {
      success: true,
      txHash,
    };
  } catch (error) {
    // Fast-path failure: nothing was written to mint_history yet, so no partial state.
    // Capture full diagnostic server-side; return only a sanitised message to the caller.
    await captureException(error, {
      area: 'minting',
      context: { chain: intent.chain, collection: intent.contractAddress },
      fingerprint: ['mint-fast', 'execute'],
    });
    return {
      success: false,
      error: 'Fast mint execution failed.',
    };
  }
}
