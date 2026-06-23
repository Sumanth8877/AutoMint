/**
 * src/lib/intent/chain-detector.ts
 *
 * Chain detection logic for NFT mint URLs.
 * Extracted from resolve-mint-intent.ts for modularity.
 */

// Domain → chain name mapping
const CHAIN_DOMAINS: Record<string, string> = {
  'etherscan.io': 'ethereum',
  'basescan.org': 'base',
  'polygonscan.com': 'polygon',
  'solscan.io': 'solana',
};

export const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const ETH_ADDRESS_SCAN_RE = /0x[0-9a-fA-F]{40}/;
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Try to detect chain from a URL hostname.
 */
export function detectChainFromHost(host: string): string | undefined {
  for (const [domain, chain] of Object.entries(CHAIN_DOMAINS)) {
    if (host === domain || host.endsWith('.' + domain)) {
      return chain;
    }
  }
  return undefined;
}

/**
 * Try to extract an Ethereum-style contract address from URL path segments.
 */
export function extractAddressFromPath(pathSegments: string[]): string | undefined {
  for (const seg of pathSegments) {
    if (ETH_ADDRESS_RE.test(seg)) {
      return seg;
    }
  }
  return undefined;
}

/**
 * Try to extract a Solana public key from URL path segments.
 */
export function extractSolanaAddressFromPath(pathSegments: string[]): string | undefined {
  return pathSegments.find((segment) => SOLANA_ADDRESS_RE.test(segment));
}

/**
 * Normalize a host string: strip port, lowercase.
 */
export function cleanHost(host: string): string {
  return host.split(':')[0].toLowerCase();
}

/**
 * Normalize OpenSea/Alchemy chain name aliases to canonical names.
 */
export function normalizeChain(value: string | undefined): string | undefined {
  const lower = value?.trim().toLowerCase();
  if (!lower) return undefined;
  if (lower === 'eth' || lower === 'ethereum' || lower === 'mainnet') return 'ethereum';
  if (lower === 'matic' || lower === 'polygon') return 'polygon';
  if (lower === 'sol' || lower === 'solana') return 'solana';
  if (lower === 'base') return 'base';
  return lower;
}
