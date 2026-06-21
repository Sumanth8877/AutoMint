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
 * Does NOT use simulation mode. Executes real transactions only.
 */

import { getDb } from '@/lib/db';
import { mintHistory } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { getMintMode } from '@/lib/blockchain/mint';
import { estimateMintGas, type MintParams } from '@/lib/blockchain/mint';
import { getDecryptedPrivateKey } from './wallet.service';
import { logActivity } from '@/lib/monitoring';
import { getMintState } from './mint-state.service';
import type { MintIntent } from '@/lib/resolve-mint-intent';
import type { Hex } from 'viem';

// ─── Types ─────────────────────────────────────────

export interface FastMintWallet {
  id: string;
  address: string;
  chain: string;
  encryptedPrivateKey?: string | null;
  userId: string;
}

export interface FastMintResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────

function buildMintParams(intent: MintIntent): MintParams {
  return {
    contractAddress: intent.contractAddress as Hex,
    mintFunction: 'mint',
    quantity: 1,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Fast mint execution failed';
}

function buildIdempotencyKeyForIntent(intent: MintIntent, wallet: FastMintWallet): string {
  return `fast_mint:${wallet.id}:${intent.contractAddress}:${intent.chain}`;
}

// ─── Fast path executor ───────────────────────────

/**
 * Execute a mint immediately, bypassing the task queue.
 *
 * Preconditions:
 * - MINT_MODE must be 'live' (throws otherwise)
 * - intent must be valid with contractAddress
 * - wallet must have an encryptedPrivateKey (imported wallet)
 *
 * Guarantees:
 * - Idempotency: returns existing txHash if already executed
 * - Fail-safe: if broadcast succeeds, DB writes always happen
 */
export async function executeMintFast(
  intent: MintIntent,
  wallet: FastMintWallet,
  userId?: string,
): Promise<FastMintResult> {
  // ── 0. Guard: must be in live mode ──────────────
  const mode = getMintMode();
  if (mode !== 'live') {
    return {
      success: false,
      error: 'MINT_MODE is not "live". Fast-path execution requires MINT_MODE=live.',
    };
  }

  if (!intent.contractAddress) {
    return { success: false, error: 'Mint intent has no contract address' };
  }

  if (!wallet.encryptedPrivateKey) {
    return { success: false, error: 'Wallet does not have an imported private key' };
  }

  try {
    // ── 1. Idempotency check ──────────────────────
    const idempotencyKey = buildIdempotencyKeyForIntent(intent, wallet);

    const [existingHistory] = await getDb()
      .select()
      .from(mintHistory)
      .where(eq(mintHistory.transactionHash, idempotencyKey))
      .limit(1);

    if (existingHistory) {
      return {
        success: true,
        txHash: existingHistory.transactionHash || undefined,
      };
    }

    // ── 2. Verify mint is LIVE on-chain ───────────
    const mintState = await getMintState(intent.contractAddress, intent.chain);
    if (mintState.status !== 'LIVE') {
      return {
        success: false,
        error: `Mint is not live (status: ${mintState.status})`,
      };
    }

    // ── 3. Decrypt wallet + prepare ───────────────
    const privateKey = await getDecryptedPrivateKey(wallet.id, wallet.userId);
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

    const walletClient = getWalletClient(intent.chain, account);

    const mintParams = buildMintParams(intent);

    // ── 4. Estimate gas ───────────────────────────
    const gasResult = await estimateMintGas(wallet.address as `0x${string}`, intent.chain, mintParams);
    if (gasResult.error) {
      return { success: false, error: `Gas estimation failed: ${gasResult.error}` };
    }

    // ── 5. Build transaction data ──────────────────
    const mintData = encodeFunctionData({
      abi: parseAbi(['function mint(uint256 quantity) payable']),
      functionName: 'mint',
      args: [BigInt(mintParams.quantity)],
    });

    const value = mintParams.mintPrice ? parseEther(mintParams.mintPrice) : BigInt(0);

    // ── 6. Broadcast transaction ───────────────────
    const txHash = await walletClient.sendTransaction({
      account,
      chain: chainObj,
      to: intent.contractAddress as `0x${string}`,
      data: mintData,
      value,
      gas: gasResult.gasLimit,
    });

    // ── 7. Wait for confirmation ───────────────────
    const { getClient } = await import('@/lib/blockchain/client');
    const publicClient = getClient(intent.chain);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== 'success') {
      return { success: false, error: 'Transaction reverted on-chain', txHash };
    }

    // ── 8. Persist mint history (idempotent key = txHash) ──
    const now = new Date();
    await getDb().insert(mintHistory).values({
      userId: wallet.userId,
      walletId: wallet.id,
      status: 'confirmed',
      transactionHash: txHash,
      gasUsed: receipt.gasUsed?.toString(),
      blockNumber: receipt.blockNumber?.toString(),
      confirmedAt: now,
    });

    // ── 9. Activity log ───────────────────────────
    if (userId) {
      await logActivity(userId, 'task_completed', 'Mint executed (fast path)', {
        taskId: undefined,
        walletId: wallet.id,
        collectionId: undefined,
        txHash,
        chain: intent.chain,
        mode,
        sourcePlatform: intent.sourcePlatform,
        fastPath: true,
      });
    }

    return {
      success: true,
      txHash,
    };
  } catch (error) {
    // Fast-path failure: nothing was written to mint_history yet, so no partial state
    return {
      success: false,
      error: getErrorMessage(error) || 'Fast mint execution failed',
    };
  }
}
