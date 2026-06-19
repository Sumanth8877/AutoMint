import { Chain, mainnet, base, polygon } from 'viem/chains';

export const SUPPORTED_CHAINS: Record<string, Chain> = {
  ethereum: mainnet,
  base: base,
  polygon: polygon,
};

export const CHAIN_NAMES = {
  ethereum: 'Ethereum',
  base: 'Base',
  polygon: 'Polygon',
} as const;

export const CHAIN_NATIVE_TOKENS = {
  ethereum: 'ETH',
  base: 'ETH',
  polygon: 'POL',
} as const;

export type ChainKey = keyof typeof CHAIN_NAMES;

export function getChain(chain: string): Chain {
  const c = SUPPORTED_CHAINS[chain.toLowerCase()];
  if (!c) throw new Error(`Unsupported chain: ${chain}`);
  return c;
}