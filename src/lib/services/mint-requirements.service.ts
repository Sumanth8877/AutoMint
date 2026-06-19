import { getClient } from '@/lib/blockchain/client';
import type { Hex } from 'viem';

const CONTRACT_ABI = ['function publicMintPrice() view returns (uint256)', 'function maxPerWallet() view returns (uint256)', 'function maxPerTx() view returns (uint256)', 'function mintStart() view returns (uint256)', 'function mintEnd() view returns (uint256)'] as const;
export interface MintRequirements { mintFunction: string; mintPrice: string; maxPerWallet?: number; maxPerTx?: number; mintStartTime?: Date; mintEndTime?: Date; }

type RequirementFunction = 'publicMintPrice' | 'maxPerWallet' | 'maxPerTx' | 'mintStart' | 'mintEnd';

async function callView(client: ReturnType<typeof getClient>, address: string, fn: RequirementFunction): Promise<bigint | undefined> { try { return await client.readContract({ address: address as Hex, abi: CONTRACT_ABI, functionName: fn }) as bigint; } catch { return undefined; } }
export async function fetchMintRequirements(contractAddress: string, chain: string): Promise<MintRequirements> { const client = getClient(chain); const [priceWei, maxPerWallet, maxPerTx, mintStart, mintEnd] = await Promise.all([callView(client, contractAddress, 'publicMintPrice'), callView(client, contractAddress, 'maxPerWallet'), callView(client, contractAddress, 'maxPerTx'), callView(client, contractAddress, 'mintStart'), callView(client, contractAddress, 'mintEnd')]); const mintPrice = typeof priceWei === 'bigint' ? (Number(priceWei) / 1e18).toFixed(6) : '0'; return { mintFunction: 'mint', mintPrice, maxPerWallet: typeof maxPerWallet === 'bigint' ? Number(maxPerWallet) : undefined, maxPerTx: typeof maxPerTx === 'bigint' ? Number(maxPerTx) : undefined, mintStartTime: typeof mintStart === 'bigint' ? new Date(Number(mintStart) * 1000) : undefined, mintEndTime: typeof mintEnd === 'bigint' ? new Date(Number(mintEnd) * 1000) : undefined }; }
