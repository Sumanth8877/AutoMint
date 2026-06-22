import { parseAbi, parseEther, Hex, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, base, polygon, type Chain } from 'viem/chains';
import { getClient } from './client';
import { getWalletClient } from '@/lib/services/rpc-manager.service';
import { getDecryptedPrivateKey } from '@/lib/services/wallet.service';
import { captureException, captureMessage } from '@/lib/observability/sentry';

// ─── MINT_MODE Configuration ─────────────────────

export type MintMode = 'simulation' | 'live';

export function getMintMode(): MintMode {
  // Force known values; anything else resolves to the default
  const raw = process.env.MINT_MODE?.trim().toLowerCase();
  if (raw === 'live') return 'live';
  // In production, default to live; in dev, default to simulation
  if (process.env.NODE_ENV === 'production') return 'live';
  return 'simulation';
}

// ─── Config ───────────────────────────────────────

const CHAIN_OBJECTS: Record<string, Chain> = {
  ethereum: mainnet,
  base: base,
  polygon: polygon,
};

// ─── Types ────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────

function getChain(chain: string): Chain {
  const c = CHAIN_OBJECTS[chain];
  if (!c) throw new Error(`Unsupported chain: ${chain}`);
  return c;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown mint error';
}

function buildMintData(params: MintParams): Hex {
  const abi = params.mintFunction === 'mint' || !params.mintFunction
    ? parseAbi(['function mint(uint256 quantity) payable'])
    : parseAbi([`function ${params.mintFunction}(uint256 quantity) payable`]);
  return encodeFunctionData({
    abi,
    functionName: params.mintFunction || 'mint',
    args: [BigInt(params.quantity)],
  });
}

// ─── Core blockchain functions ────────────────────

/**
 * Simulate a mint call using `eth_call` (read-only, no state change).
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
    return {
      success: false,
      error: getErrorMessage(error) || 'Simulation failed',
    };
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
      return {
        gasLimit: BigInt(200000),
        error: getErrorMessage(error) || 'Gas estimation failed',
      };
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

    // Try common public mint state getters
    const abi = parseAbi([
      'function publicMintActive() view returns (bool)',
      'function maxSupply() view returns (uint256)',
      'function totalSupply() view returns (uint256)',
    ] as const);

    let publicMintActive = false;
    try {
      publicMintActive = await client.readContract({
        address,
        abi,
        functionName: 'publicMintActive',
      });
    } catch {
      // Contract may not have this function
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
 * Enforces MINT_MODE:
 * - If MINT_MODE !== 'live' → throws, telling the caller to use simulateMint() instead
 * - If MINT_MODE === 'live'  → broadcasts a real transaction
 *
 * Requires PRIVATE_KEY to be set when MINT_MODE=live.
 */
export async function executeMint(
  address: Hex,
  chain: string,
  params: MintParams,
  userId?: string,
  options?: { walletId?: string },
): Promise<MintResult> {
  // ── Guard: must be in 'live' mode ──────────────────
  const mode = getMintMode();
  if (mode !== 'live') {
    return {
      success: false,
      error:
        'MINT_MODE is not set to "live". Use simulateMint() for simulation-only mode, ' +
        'or set MINT_MODE=live to execute real transactions.',
    };
  }

  try {
    // Simulate first to catch obvious failures
    const sim = await simulateMint(address, chain, params, userId);
    if (!sim.success) {
      return { success: false, error: sim.error };
    }

    // ── Build and broadcast real transaction ─────────
    const mintData = buildMintData(params);

    // Resolve private key: prefer per-wallet key, fall back to global PRIVATE_KEY
    let privateKey: Hex | undefined;
    if (options?.walletId && userId) {
      try {
        const decrypted = await getDecryptedPrivateKey(options.walletId, userId);
        privateKey = (decrypted.startsWith('0x') ? decrypted : `0x${decrypted}`) as Hex;
      } catch (error) {
        return {
          success: false,
          error: `Failed to decrypt wallet private key: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    } else {
      privateKey = process.env.PRIVATE_KEY as Hex | undefined;
    }

    if (!privateKey) {
      return {
        success: false,
        error: 'No signing key available. Provide a walletId with an encrypted private key, or set PRIVATE_KEY env var.',
      };
    }

    const account = privateKeyToAccount(privateKey);
    const walletClient = getWalletClient(chain, account, { userId });

    const value = params.mintPrice ? parseEther(params.mintPrice) : BigInt(0);

    const hash = await walletClient.sendTransaction({
      account,
      chain: getChain(chain),
      to: params.contractAddress,
      data: mintData,
      value,
      gas: params.gasLimit ? BigInt(params.gasLimit) : undefined,
    });

    // Wait for 1 confirmation
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
