import 'server-only';

import { parseAbi, parseEther, Hex, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, base, polygon, type Chain } from 'viem/chains';
import { getClient } from './client';
import { getWalletClient } from '@/lib/services/rpc-manager.service';
import { getDecryptedPrivateKey } from '@/lib/services/wallet.service';
import { captureException, captureMessage } from '@/lib/observability/sentry';

import {
  allocateNonce,
  releaseInflightNonce,
  scanAndFillGaps,
} from '@/lib/services/nonce-allocator.service';

// ─── Config ──────────────────────────────────────────

const CHAIN_OBJECTS: Record<string, Chain> = {
  ethereum: mainnet,
  base: base,
  polygon: polygon,
};

// ─── Types ───────────────────────────────────────────

export interface MintParams {
  contractAddress: Hex;
  mintFunction?: string;
  mintPrice?: string;
  gasLimit?: string;
  quantity: number;
}

export interface MintResult {
  success: boolean;
  txHash?: Hex;
  gasUsed?: string;
  blockNumber?: bigint;
  error?: string;
}

/**
 * Execute the mint transaction on chain.
 *
 * Security invariants (C-1):
 *   - userId is REQUIRED. Anonymous minting is rejected at both the type
 *     level and at runtime.
 *   - walletId is REQUIRED. Missing wallet is rejected before any DB access.
 *   - process.env.PRIVATE_KEY is NEVER consulted. Removed entirely.
 *   - The signing key is resolved exclusively from per-user encrypted storage
 *     via getDecryptedPrivateKey(walletId, userId), which enforces ownership
 *     at the DB layer (wallets.userId = userId predicate).
 *   - Error messages returned to callers are sanitised: they do not expose
 *     walletId values, decryption internals, or stack traces.
 *   - Full diagnostic details are logged server-side via captureException.
 */
export async function executeMint(
  address: Hex,
  chain: string,
  params: MintParams,
  userId: string,                 // REQUIRED — was `userId?: string`
  options: { walletId: string },  // REQUIRED — was `options?: { walletId?: string }`
): Promise<MintResult> {
  // ── Guard: userId is mandatory ───────────────────────────────────
  // Runtime check in addition to the TypeScript type requirement,
  // to defend against JS callers and dynamically-constructed payloads.
  if (!userId || !userId.trim()) {
    return {
      success: false,
      error: 'Mint execution requires an authenticated user.',
    };
  }

  // ── Guard: walletId is mandatory ─────────────────────────────────
  if (!options.walletId || !options.walletId.trim()) {
    return {
      success: false,
      error: 'Mint execution requires a wallet selection.',
    };
  }

  try {
    // Simulate first to catch obvious failures before touching the key.
    const sim = await simulateMint(address, chain, params, userId);
    if (!sim.success) {
      return { success: false, error: sim.error };
    }

    // ── Decrypt per-user signing key ──────────────────────────────
    // getDecryptedPrivateKey(walletId, userId) enforces ownership at the
    // DB layer: it only returns a key when wallets.id = walletId AND
    // wallets.userId = userId. Cross-user access returns "Wallet not found".
    //
    // The decrypted key is used immediately to build the account object
    // and is never stored, logged, or returned to the caller.
    let privateKey: Hex;
    try {
      const decrypted = await getDecryptedPrivateKey(options.walletId, userId);
      privateKey = (decrypted.startsWith('0x') ? decrypted : `0x${decrypted}`) as Hex;
    } catch (keyError) {
      // Log full diagnostic detail server-side only — never returned to caller.
      await captureException(keyError, {
        area: 'minting',
        context: { chain, collection: params.contractAddress },
        fingerprint: ['mint', 'key-decryption'],
      });
      // Sanitised error: no walletId, no crypto internals, no stack traces.
      // Classify error safely: check for ownership/access-related messages.
      // This set covers messages from wallet DB lookup, access control, and
      // any middleware that enforces per-user ownership.
      // All other errors (crypto failures, format errors) fall to the generic path.
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

    // ── Build and broadcast transaction ───────────────────────────
    const mintData = buildMintData(params);
    const account = privateKeyToAccount(privateKey);
    const walletClient = getWalletClient(chain, account, { userId });

    // ── C-03 Fix: allocate unique nonce ─────────────────────────────────────
    const nonceResult = await allocateNonce(account.address, chain).catch(() => null);
    const allocatedNonce: number | undefined = nonceResult?.nonce;
    const value = params.mintPrice ? parseEther(params.mintPrice) : BigInt(0);

    // C-04: hoist hash before the receipt try so the catch block can always return it.
    // If sendTransaction succeeds, hash is defined and must never be discarded —
    // even when waitForTransactionReceipt subsequently times out.
    let hash: Hex | undefined;

    try {
      hash = await walletClient.sendTransaction({
        account,
        chain: getChain(chain),
        to: params.contractAddress,
        data: mintData,
        value,
        gas: params.gasLimit ? BigInt(params.gasLimit) : undefined,
        // C-03: explicit nonce prevents concurrent workers from getting the same value
        ...(allocatedNonce !== undefined && { nonce: allocatedNonce }),
      });
    } catch (broadcastError) {
      // sendTransaction itself failed — transaction was never broadcast.
      // Safe to retry; no hash to preserve.
      await captureException(broadcastError, {
        area: 'minting',
        context: { wallet: address, chain, collection: params.contractAddress },
        fingerprint: ['mint', 'broadcast'],
      });
      return {
        success: false,
        error: getErrorMessage(broadcastError) || 'Transaction broadcast failed',
      };
    }

    // Post-broadcast: release inflight tracking and scan for gaps.
    // hash is guaranteed to be defined here.
    if (allocatedNonce !== undefined) {
      void releaseInflightNonce(account.address, chain, allocatedNonce).catch(() => undefined);
      void scanAndFillGaps(account.address, chain).catch(() => undefined);
    }

    // ── Wait for 1 confirmation ─────────────────────────────────────────
    // From this point the transaction is live on-chain. Any error MUST
    // preserve hash so the caller can track the existing tx rather than
    // broadcasting a second one.
    try {
      const client = getClient(chain, userId);
      const receipt = await client.waitForTransactionReceipt({ hash });

      if (receipt.status !== 'success') {
        await captureMessage('Mint transaction reverted', {
          area: 'minting',
          level: 'error',
          context: { wallet: address, chain, collection: params.contractAddress, transactionHash: hash },
          fingerprint: ['mint', 'reverted'],
        });
      }

      return {
        success: receipt.status === 'success',
        txHash: hash,
        gasUsed: receipt.gasUsed?.toString(),
        blockNumber: receipt.blockNumber,
      };
    } catch (receiptError) {
      // waitForTransactionReceipt timed out or failed — but the transaction IS
      // on-chain. Return txHash so the caller transitions to 'unconfirmed'
      // and polls for the receipt without broadcasting a second transaction.
      await captureException(receiptError, {
        area: 'minting',
        context: { wallet: address, chain, collection: params.contractAddress, transactionHash: hash },
        fingerprint: ['mint', 'receipt-timeout'],
      });
      return {
        success: false,
        txHash: hash,
        error: 'receipt_timeout',
      };
    }
  } catch (error) {
    // Catch-all for errors before sendTransaction (key decryption,
    // gas estimation, nonce allocation). No hash exists at this stage.
    await captureException(error, {
      area: 'minting',
      context: { wallet: address, chain, collection: params.contractAddress },
      fingerprint: ['mint', 'execute'],
    });
    return {
      success: false,
      error: getErrorMessage(error) || 'Mint execution failed',
    };
  }
}
