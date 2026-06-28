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
const EIP1967_IMPL_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex;

function extractEip1167Implementation(bytecode: string): string | null {
  // Minimal proxy runtime: 363d3d373d3d3d363d73<20-byte impl>5af43d82803e903d91602b57fd5bf3
  const m = /^0x363d3d373d3d3d363d73([0-9a-fA-F]{40})5af43d82803e903d91602b57fd5bf3$/.exec(bytecode);
  return m ? `0x${m[1]}` : null;
}

/**
 * Resolve a proxy contract to its implementation address. Many NFTs (incl. most
 * OpenSea/SeaDrop drops) are EIP-1167 minimal-proxy clones or EIP-1967
 * upgradeable proxies; Etherscan getabi on the proxy returns the wrong ABI.
 * Returns the original address when it is not a recognised proxy.
 */
export async function resolveImplementationAddress(contractAddress: string, chain: string): Promise<string> {
  try {
    const client = getClient(chain);
    const code = await client.getBytecode({ address: contractAddress as Hex });
    if (code) {
      const clone = extractEip1167Implementation(code);
      if (clone && /^0x[0-9a-fA-F]{40}$/.test(clone) && clone !== '0x0000000000000000000000000000000000000000') {
        return clone;
      }
    }
    const slot = await client.getStorageAt({ address: contractAddress as Hex, slot: EIP1967_IMPL_SLOT });
    if (slot && slot.length >= 66) {
      const impl = `0x${slot.slice(-40)}`;
      if (/^0x[0-9a-fA-F]{40}$/.test(impl) && impl !== '0x0000000000000000000000000000000000000000') {
        return impl;
      }
    }
  } catch {
    // fall through to the original address
  }
  return contractAddress;
}

export async function discoverContractABI(
  contractAddress: string,
  chain: string,
): Promise<DiscoveredABI> {
  // ── 1. Etherscan (full verified ABI) ─────────────────────────────
  const implAddress = await resolveImplementationAddress(contractAddress, chain);
  const etherscanAbi =
    (await fetchAbiFromEtherscan(implAddress, chain)) ??
    (implAddress !== contractAddress ? await fetchAbiFromEtherscan(contractAddress, chain) : null);
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
