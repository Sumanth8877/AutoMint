import { createWalletClient, http, parseAbi, parseAbiParameters, Hex, encodeFunctionData } from 'viem';
import { mainnet, base, polygon } from 'viem/chains';
import { getClient } from './client';
import { logActivity } from '@/lib/monitoring';

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
 * Simulate a mint call using `eth_call`.
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
      value: params.mintPrice ? BigInt(Math.round(parseFloat(params.mintPrice) * 1e18)) : BigInt(0),
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
      value: params.mintPrice ? BigInt(Math.round(parseFloat(params.mintPrice) * 1e18)) : BigInt(0),
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
 * Execute the mint transaction.
 * Note: Requires private key management in production.
 * Currently returns simulation-only. Real execution requires
 * wallet signing infrastructure (Phase 5 security layer).
 */
export async function executeMint(
  _address: Hex,
  chain: string,
  params: MintParams,
  _simulateOnly = true,
): Promise<MintResult> {
  try {
    // Simulate first
    const sim = await simulateMint(_address, chain, params);
    if (!sim.success) {
      return { success: false, error: sim.error };
    }

    if (_simulateOnly) {
      // In production, this would sign and broadcast with a private key
      // For now, we return the simulation result as a placeholder
      return {
        success: true,
        txHash: undefined,
        gasUsed: undefined,
        blockNumber: undefined,
      };
    }

    // Real execution path (requires Phase 5 wallet security)
    const client = getClient(chain);
    const mintData = buildMintData(params);

    // This would use a wallet client with private key in production
    // const walletClient = createWalletClient({ chain, transport: http(getRpcUrl(chain)) });
    // const hash = await walletClient.sendTransaction({ ... });

    return {
      success: true,
      txHash: undefined,
      gasUsed: undefined,
      blockNumber: undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Mint execution failed',
    };
  }
}