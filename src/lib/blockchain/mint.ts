import { createWalletClient, http, parseAbi, parseEther, Hex, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, base, polygon } from 'viem/chains';
import { getClient } from './client';
import { logActivity } from '@/lib/monitoring';

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

const VOUCHED_RPC = process.env.ALCHEMY_API_KEY
  ? {
      ethereum: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      base: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      polygon: `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
    }
  : {};

function getRpcUrl(chain: string): string {
  const v = VOUCHED_RPC[chain as keyof typeof VOUCHED_RPC];
  if (!v) throw new Error(`No RPC configured for chain: ${chain}`);
  return v;
}

const CHAIN_OBJECTS: Record<string, any> = {
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

function getChain(chain: string) {
  const c = CHAIN_OBJECTS[chain];
  if (!c) throw new Error(`Unsupported chain: ${chain}`);
  return c as any;
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
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getClient(chain);
    const mintData = buildMintData(params);

    await client.call({
      to: params.contractAddress,
      data: mintData,
      value: params.mintPrice ? parseEther(params.mintPrice) : BigInt(0),
    });

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Simulation failed',
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
): Promise<{ gasLimit: bigint; error?: string }> {
  try {
    const client = getClient(chain);
    const mintData = buildMintData(params);

    const estimate = await client.estimateGas({
      to: params.contractAddress,
      data: mintData,
      value: params.mintPrice ? parseEther(params.mintPrice) : BigInt(0),
    });

    return { gasLimit: estimate };
  } catch (error: any) {
      return {
        gasLimit: BigInt(200000),
        error: error?.message || 'Gas estimation failed',
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
  } catch (error: any) {
    return { eligible: false, reason: error?.message || 'Eligibility check failed' };
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
    const sim = await simulateMint(address, chain, params);
    if (!sim.success) {
      return { success: false, error: sim.error };
    }

    // ── Build and broadcast real transaction ─────────
    const chainObj = getChain(chain);
    const mintData = buildMintData(params);

    const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
    if (!privateKey) {
      return {
        success: false,
        error:
          'PRIVATE_KEY environment variable is required when MINT_MODE=live. ' +
          'Set PRIVATE_KEY to the wallet private key that will sign transactions.',
      };
    }

    const account = privateKeyToAccount(privateKey);

    const walletClient = createWalletClient({
      account,
      chain: chainObj,
      transport: http(getRpcUrl(chain)),
    });

    const value = params.mintPrice ? parseEther(params.mintPrice) : BigInt(0);

    const hash = await walletClient.sendTransaction({
      chain: chainObj,
      to: params.contractAddress,
      data: mintData,
      value,
      gas: params.gasLimit ? BigInt(params.gasLimit) : undefined,
    });

    // Wait for 1 confirmation
    const client = getClient(chain);
    const receipt = await client.waitForTransactionReceipt({ hash });

    return {
      success: receipt.status === 'success',
      txHash: hash,
      gasUsed: receipt.gasUsed?.toString(),
      blockNumber: receipt.blockNumber,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Mint execution failed',
    };
  }
}