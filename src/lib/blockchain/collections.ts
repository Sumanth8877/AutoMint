import { getClient } from './client';
import { CHAIN_NAMES } from './chains';

export interface CollectionMetadata {
  name: string;
  symbol: string;
  totalSupply: bigint;
  owner: string;
  tokenStandard: 'ERC721' | 'ERC1155' | 'Unknown';
}

// ERC721 ABI (minimal)
const ERC721_ABI = [
  { inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'owner', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
] as const;

// ERC1155 ABI (minimal)
const ERC1155_ABI = [
  { inputs: [], name: 'uri', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
] as const;

export async function getCollectionMetadata(contractAddress: string, chain: string): Promise<CollectionMetadata> {
  try {
    const client = getClient(chain);
    const address = contractAddress as `0x${string}`;

    // Try ERC721 first
    try {
      const [name, symbol, totalSupply, owner] = await Promise.all([
        client.readContract({ address, abi: ERC721_ABI, functionName: 'name' }),
        client.readContract({ address, abi: ERC721_ABI, functionName: 'symbol' }),
        client.readContract({ address, abi: ERC721_ABI, functionName: 'totalSupply' }),
        client.readContract({ address, abi: ERC721_ABI, functionName: 'owner' }),
      ]);

      return {
        name: name as string,
        symbol: symbol as string,
        totalSupply: totalSupply as bigint,
        owner: owner as string,
        tokenStandard: 'ERC721',
      };
    } catch {
      // Try ERC1155
      try {
        await client.readContract({ address, abi: ERC1155_ABI, functionName: 'uri' });

        return {
          name: CHAIN_NAMES[chain as keyof typeof CHAIN_NAMES] || 'Unknown',
          symbol: 'ERC1155',
          totalSupply: BigInt(0),
          owner: address,
          tokenStandard: 'ERC1155',
        };
      } catch {
        return {
          name: 'Unknown Collection',
          symbol: 'UNKNOWN',
          totalSupply: BigInt(0),
          owner: address,
          tokenStandard: 'Unknown',
        };
      }
    }
  } catch (error) {
    console.error(`Error fetching collection metadata for ${contractAddress} on ${chain}:`, error);
    throw new Error('Failed to fetch collection metadata');
  }
}

export function getContractType(standard: string): string {
  switch (standard) {
    case 'ERC721': return 'ERC-721';
    case 'ERC1155': return 'ERC-1155';
    default: return 'Unknown';
  }
}
