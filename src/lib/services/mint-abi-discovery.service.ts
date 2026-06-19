import { getClient } from '@/lib/blockchain/client';

export type AbiSource = 'etherscan' | 'cached' | 'selector_inspection' | 'fallback';

export interface DiscoveredABI {
  abi: readonly any[];
  source: AbiSource;
  confidence: number;
}

const MINT_FUNCTIONS = ['mint','publicMint','purchase','mintTo','mintWithComment','claim','buy','mintNFT','mintPublic','saleMint'] as const;

export function discoverMintFunction(abi: readonly any[]): { functionName: string; selector: string; confidence: number } {
  const payable = abi.filter((f: any) => f.type === 'function' && f.stateMutability === 'payable');
  for (const fn of MINT_FUNCTIONS) {
    const match = payable.find((f: any) => f.name === fn);
    if (match) return { functionName: fn, selector: fn + '(', confidence: 0.9 };
  }
  if (payable.length > 0) return { functionName: payable[0].name, selector: payable[0].name + '(', confidence: 0.5 };
  return { functionName: 'mint', selector: 'mint(uint256)', confidence: 0.3 };
}

export async function discoverContractABI(contractAddress: string, chain: string): Promise<DiscoveredABI> {
  const client = getClient(chain);
  const selectors = ['0x1249c58b','0x84bb1e10','0xefef39a1'];
  for (const sel of selectors) {
    try {
      const r = await client.call({ to: contractAddress as any, data: sel as any });
      if (r && String(r) !== '0x') return { abi: [], source: 'selector_inspection', confidence: 0.6 };
    } catch {}
  }
  return { abi: [], source: 'fallback', confidence: 0.3 };
}