// ── Single source of truth for supported chains ─────────────────────────────
// All chain lists across the codebase (route handlers, Drizzle enums, UI) must
// derive from these constants. Do NOT redeclare ['ethereum','base','polygon'].
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

/** Tuple of valid chain keys — use this wherever you need a runtime array. */
export const CHAIN_KEYS = Object.keys(CHAIN_NAMES) as ChainKey[];

export function getChain(chain: string): Chain {
  const c = SUPPORTED_CHAINS[chain.toLowerCase()];
  if (!c) throw new Error(`Unsupported chain: ${chain}`);
  return c;
}