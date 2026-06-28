import { getClient } from '@/lib/blockchain/client';
import type { Hex } from 'viem';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';

const CONTRACT_ABI = ['function publicMintPrice() view returns (uint256)', 'function maxPerWallet() view returns (uint256)', 'function maxPerTx() view returns (uint256)', 'function mintStart() view returns (uint256)', 'function mintEnd() view returns (uint256)'] as const;
export interface MintRequirements { mintFunction: string; mintPrice: string; maxPerWallet?: number; maxPerTx?: number; mintStartTime?: Date; mintEndTime?: Date; isSoldOut?: boolean; }

type RequirementFunction = 'publicMintPrice' | 'maxPerWallet' | 'maxPerTx' | 'mintStart' | 'mintEnd';

async function callView(client: ReturnType<typeof getClient>, address: string, fn: RequirementFunction): Promise<bigint | undefined> { try { return await client.readContract({ address: address as Hex, abi: CONTRACT_ABI, functionName: fn }) as bigint; } catch { return undefined; } }

/**
 * Fetch mint requirements AND discover the correct mint function name in parallel.
 *
 * Speed fix: ABI discovery previously happened at execution time (inside executeMint),
 * adding 300-600ms to the hot path. Now it runs concurrently with the contract
 * view calls during task creation, so zero latency is added to execution.
 *
 * The discovered mintFunction is stored in the DB task record and passed directly
 * to executeMint via params.mintFunction — no discovery needed at execution time.
 */
export async function fetchMintRequirements(contractAddress: string, chain: string): Promise<MintRequirements> {
  const client = getClient(chain);

  // Run ABI discovery and contract view reads in parallel — both are independent
  const [
    priceWei, maxPerWallet, maxPerTx, mintStart, mintEnd,
    abiResult,
  ] = await Promise.all([
    callView(client, contractAddress, 'publicMintPrice'),
    callView(client, contractAddress, 'maxPerWallet'),
    callView(client, contractAddress, 'maxPerTx'),
    callView(client, contractAddress, 'mintStart'),
    callView(client, contractAddress, 'mintEnd'),
    // Speed fix: discover the mint function name now so it's stored in the DB.
    // At execution time, params.mintFunction will already be set — no ABI lookup needed.
    discoverContractABI(contractAddress, chain).catch(() => null),
  ]);

  const mintPrice = typeof priceWei === 'bigint' ? (Number(priceWei) / 1e18).toFixed(6) : '0';

  // Use the discovered function name; fall back to 'mint' if discovery failed
  const mintFunction = abiResult && abiResult.abi.length > 0
    ? discoverMintFunction(abiResult.abi).functionName
    : 'mint';

  return {
    mintFunction,
    mintPrice,
    maxPerWallet: typeof maxPerWallet === 'bigint' ? Number(maxPerWallet) : undefined,
    maxPerTx: typeof maxPerTx === 'bigint' ? Number(maxPerTx) : undefined,
    mintStartTime: typeof mintStart === 'bigint' ? new Date(Number(mintStart) * 1000) : undefined,
    mintEndTime: typeof mintEnd === 'bigint' ? new Date(Number(mintEnd) * 1000) : undefined,
  };
}
