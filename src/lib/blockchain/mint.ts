import 'server-only';

import { parseAbi, parseEther, Hex, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, base, polygon, type Chain } from 'viem/chains';
import { getClient } from './client';
import { getWalletClient } from '@/lib/services/rpc-manager.service';
import { getDecryptedPrivateKey } from '@/lib/services/wallet.service';
import { captureException, captureMessage } from '@/lib/observability/sentry';

// ─── MINT_MODE Configuration ─────────────────────────
import {
  allocateNonce,
  releaseInflightNonce,
  scanAndFillGaps,
} from '@/lib/services/nonce-allocator.service';


export type MintMode = 'simulation' | 'live';

export function getMintMode(): MintMode {
  const raw = process.env.MINT_MODE?.trim().toLowerCase();
  if (raw === 'live') return 'live';
  if (process.env.NODE_ENV === 'production') return 'live';
  return 'simulation';
}

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

export interface MintEligibility {
  eligible: boolean;
  reason?: string;
  publicMintActive?: boolean;
}

// ─── Helpers ─────────────────────────────────────────

function getChain(chain: string): Chain {
  const c = CHAIN_OBJECTS[chain];
  if (!c) throw new Error(`Unsupported chain: ${chain}`);
  return c;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown mint error';
}

function buildMintData(params: MintParams): Hex {
  const abi =
    params.mintFunction === 'mint' || !params.mintFunction
      ? parseAbi(['function mint(uint256 quantity) payable'])
      : parseAbi([`function ${params.mintFunction}(uint256 quantity) payable`]);
  return encodeFunctionData({
    abi,
    functionName: params.mintFunction || 'mint',
    args: [BigInt(params.quantity)],
  });
}

// ─── Core blockchain functions ────────────────────────

/**
 * Simulate a mint call using eth_call (read-only, no state change).
 */
export async function simulateMint(
  address: Hex,
  chain: string,
  params: MintParams,
  userId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getClient(chain, userId);
    const mintData = buildMintData(params);
    await client.call({
      to: params.contractAddress,
      data: mintData,
      value: params.mintPrice ? parseEther(params.mintPrice) : BigInt(0),
    });
    return { success: true };
  } catch (error) {
    await captureException(error, {
      area: 'minting',
      context: { wallet: address, chain, collection: params.contractAddress },
      fingerprint: ['mint', 'simulate-contract-call'],
    });
    return { success: false, error: getErrorMessage(error) || 'Simulation failed' };
  }
}

/**
 * Estimate gas for the mint transaction.
 */
export async function estimateMintGas(
  address: Hex,
  chain: string,
  params: MintParams,
  userId?: string,
): Promise<{ gasLimit: bigint; error?: string }> {
  try {
    const client = getClient(chain, userId);
    const mintData = buildMintData(params);
    const estimate = await client.estimateGas({
      to: params.contractAddress,
      data: mintData,
      value: params.mintPrice ? parseEther(params.mintPrice) : BigInt(0),
    });
    return { gasLimit: estimate };
  } catch (error) {
    await captureException(error, {
      area: 'minting',
      context: { wallet: address, chain, collection: params.contractAddress },
      fingerprint: ['mint', 'gas-estimation'],
    });
    return { gasLimit: BigInt(200000), error: getErrorMessage(error) || 'Gas estimation failed' };
  }
}

/**
 * Check mint eligibility by calling public mint view functions if available.
 */
export async function checkMintEligibility(
  chain: string,
  params: MintParams,
): Promise<MintEligibility> {
  try {
    const client = getClient(chain);
    const address = params.contractAddress;
    const abi = parseAbi([
      'function publicMintActive() view returns (bool)',
      'function maxSupply() view returns (uint256)',
      'function totalSupply() view returns (uint256)',
    ] as const);

    let publicMintActive = false;
    try {
      publicMintActive = await client.readContract({ address, abi, functionName: 'publicMintActive' });
    } catch {
      return { eligible: true, publicMintActive: undefined };
    }

    if (!publicMintActive) {
      return { eligible: false, reason: 'Public mint is not active', publicMintActive: false };
    }
    return { eligible: true, publicMintActive: true };
  } catch (error) {
    return { eligible: false, reason: getErrorMessage(error) || 'Eligibility check failed' };
  }
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
  // ── Guard: must be in 'live' mode ────────────────────────────────
  const mode = getMintMode();
  if (mode !== 'live') {
    return {
      success: false,
      error:
        'MINT_MODE is not set to "live". Use simulateMint() for simulation-only mode, ' +
        'or set MINT_MODE=live to execute real transactions.',
    };
  }

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
    let allocatedNonce: number | undefined;
    const nonceResult = await allocateNonce(account.address, chain).catch(() => null);
    allocatedNonce = nonceResult?.nonce;
    const value = params.mintPrice ? parseEther(params.mintPrice) : BigInt(0);

    const hash = await walletClient.sendTransaction({
      account,
      chain: getChain(chain),
      to: params.contractAddress,
      data: mintData,
      value,
      gas: params.gasLimit ? BigInt(params.gasLimit) : undefined,
      // C-03: explicit nonce prevents concurrent workers from getting the same value
      ...(allocatedNonce !== undefined && { nonce: allocatedNonce }),
    });

    // Post-broadcast: release inflight tracking and scan for gaps
    if (allocatedNonce !== undefined) {
      void releaseInflightNonce(account.address, chain, allocatedNonce).catch(() => undefined);
      void scanAndFillGaps(account.address, chain).catch(() => undefined);
    }

    // ── Wait for 1 confirmation ───────────────────────────────────
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
  } catch (error) {
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
