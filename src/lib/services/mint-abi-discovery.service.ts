import { getClient } from '@/lib/blockchain/client';
import type { Abi, AbiFunction, Hex } from 'viem';

export type AbiSource = 'etherscan' | 'cached' | 'selector_inspection' | 'fallback';

export interface DiscoveredABI {
  abi: Abi;
  source: AbiSource;
  confidence: number;
}

const MINT_FUNCTIONS = [
  'mint', 'publicMint', 'purchase', 'mintTo', 'mintWithComment',
  'claim', 'buy', 'mintNFT', 'mintPublic', 'saleMint',
] as const;

// ─── Chain → Etherscan API mapping ───────────────────────────────
const ETHERSCAN_APIS: Record<string, string> = {
  ethereum: 'https://api.etherscan.io/api',
  base:     'https://api.basescan.org/api',
  polygon:  'https://api.polygonscan.com/api',
};

function getEtherscanApiKey(chain: string): string | undefined {
  // Use chain-specific key if available, fall back to generic ETHERSCAN_API_KEY
  return (
    process.env[`ETHERSCAN_${chain.toUpperCase()}_API_KEY`] ??
    process.env.ETHERSCAN_API_KEY
  );
}

// ─── ABI fetching via Etherscan ───────────────────────────────────

async function fetchAbiFromEtherscan(
  contractAddress: string,
  chain: string,
): Promise<Abi | null> {
  const baseUrl = ETHERSCAN_APIS[chain.toLowerCase()];
  if (!baseUrl) return null;

  const apiKey = getEtherscanApiKey(chain);
  const url = new URL(baseUrl);
  url.searchParams.set('module', 'contract');
  url.searchParams.set('action', 'getabi');
  url.searchParams.set('address', contractAddress);
  if (apiKey) url.searchParams.set('apikey', apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return null;

    const json = await res.json() as { status: string; result: string };
    if (json.status !== '1' || !json.result || json.result === 'Contract source code not verified') {
      return null;
    }

    return JSON.parse(json.result) as Abi;
  } catch {
    return null;
  }
}

// ─── Mint function detection ──────────────────────────────────────

function isPayableFunction(fragment: Abi[number]): fragment is AbiFunction {
  return fragment.type === 'function' && fragment.stateMutability === 'payable';
}

export function discoverMintFunction(abi: Abi): {
  functionName: string;
  selector: string;
  confidence: number;
} {
  const payable = abi.filter(isPayableFunction);

  for (const fn of MINT_FUNCTIONS) {
    const match = payable.find((f) => f.name === fn);
    if (match) return { functionName: fn, selector: fn + '(', confidence: 0.9 };
  }

  if (payable.length > 0) {
    return { functionName: payable[0].name, selector: payable[0].name + '(', confidence: 0.5 };
  }

  return { functionName: 'mint', selector: 'mint(uint256)', confidence: 0.3 };
}

// ─── Main ABI discovery ───────────────────────────────────────────

/**
 * Discover the ABI for an NFT contract.
 *
 * Priority:
 *   1. Etherscan/Basescan/Polygonscan API (verified source — full ABI)
 *   2. Selector probing (detects payable function by 4-byte selector)
 *   3. Fallback (assume standard mint(uint256) signature)
 *
 * Returns a non-empty ABI when Etherscan has the verified source.
 * Returns an empty ABI for unverified contracts — callers fall back
 * to the default mint(uint256 quantity) encoding via discoverMintFunction().
 */
export async function discoverContractABI(
  contractAddress: string,
  chain: string,
): Promise<DiscoveredABI> {
  // ── 1. Etherscan (full verified ABI) ─────────────────────────────
  const etherscanAbi = await fetchAbiFromEtherscan(contractAddress, chain);
  if (etherscanAbi && etherscanAbi.length > 0) {
    return { abi: etherscanAbi, source: 'etherscan', confidence: 0.95 };
  }

  // ── 2. Selector probing (detects payable functions by 4-byte call) ─
  const client = getClient(chain);
  const selectors: Hex[] = ['0x1249c58b', '0x84bb1e10', '0xefef39a1'];

  for (const sel of selectors) {
    try {
      const r = await client.call({ to: contractAddress as Hex, data: sel });
      if (r && String(r) !== '0x') {
        return { abi: [], source: 'selector_inspection', confidence: 0.6 };
      }
    } catch {
      // selector not found — try next
    }
  }

  // ── 3. Fallback (assume standard ERC-721 mint interface) ──────────
  return { abi: [], source: 'fallback', confidence: 0.3 };
}
