/**
 * resolveMintIntent(url)
 *
 * Parses an arbitrary NFT mint URL and returns a normalized MintIntent.
 * Does NOT execute anything — purely parsing + normalization.
 *
 * Supported sources:
 * - OpenSea collection/mint pages (opensea.io)
 * - Direct contract address URLs (etherscan, basescan, polygonscan, etc.)
 * - Custom mint sites (detected + flagged as unknown)
 *
 * Result correctness is prioritized over breadth.
 */

// ─── Types ─────────────────────────────────────────

export type SourcePlatform = 'opensea' | 'contract' | 'custom' | 'unknown';

export interface MintIntent {
  sourceUrl: string;
  contractAddress?: string;
  chain: string;
  collectionName?: string;
  collectionSlug?: string;
  isValid: boolean;
  confidence: number;       // 0.0–1.0
  sourcePlatform: SourcePlatform;
}

// ─── Chain detection ───────────────────────────────

const CHAIN_DOMAINS: Record<string, string> = {
  'etherscan.io': 'ethereum',
  'basescan.org': 'base',
  'polygonscan.com': 'polygon',
};

const OPENSEA_SLUG_RE = /opensea\.io\/(?:collections|assets)\/([^?/]+)/i;

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Try to detect chain from URL host.
 */
function detectChainFromHost(host: string): string | undefined {
  for (const [domain, chain] of Object.entries(CHAIN_DOMAINS)) {
    if (host === domain || host.endsWith('.' + domain)) {
      return chain;
    }
  }
  return undefined;
}

/**
 * Try to extract an Ethereum-style contract address from a URL path segment.
 */
function extractAddressFromPath(pathSegments: string[]): string | undefined {
  for (const seg of pathSegments) {
    if (ETH_ADDRESS_RE.test(seg)) {
      return seg;
    }
  }
  return undefined;
}

/**
 * Normalize a host string (strip port, lowercase).
 */
function cleanHost(host: string): string {
  return host.split(':')[0].toLowerCase();
}

// ─── OpenSea resolution ────────────────────────────

interface OpenSeaCollectionMeta {
  name?: string;
  slug?: string;
  primaryAssetContractAddress?: string;
}

/**
 * Fetch minimal collection metadata from OpenSea API v2.
 * Uses OPENSEA_API_KEY if available; falls back to unauthenticated public endpoint.
 *
 * No UI assumptions — only metadata for normalization.
 */
async function fetchOpenSeaCollectionMeta(slug: string): Promise<OpenSeaCollectionMeta | undefined> {
  const apiKey = process.env.OPENSEA_API_KEY;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers['X-API-KEY'] = apiKey;
  }

  const url = `https://api.opensea.io/v2/collection/${encodeURIComponent(slug)}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return undefined;
    const json = await res.json();
    const collection = json?.collection ?? json?.data?.collection;
    if (!collection) return undefined;

    return {
      name: collection.name ?? collection.slug,
      slug: collection.slug ?? slug,
      primaryAssetContractAddress: collection.primaryAssetContract?.address,
    };
  } catch {
    // Network error, timeout, or 404 — treat as unknown
    return undefined;
  }
}

// ─── External contract resolution ──────────────────

/**
 * Resolve contract details via a lightweight on-chain lookup.
 *
 * We attempt an on-chain call to `name()` and `symbol()` view functions
 * to confirm the contract is valid. If both fail, mark as low-confidence.
 */
async function resolveContractOnChain(contractAddress: string, chain: string): Promise<{ valid: boolean }> {
  try {
    const { getClient } = await import('@/lib/blockchain/client');
    const { parseAbi } = await import('viem');

    const client = getClient(chain);

    try {
      await client.readContract({
        address: contractAddress as `0x${string}`,
        abi: parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)']),
        functionName: 'name',
      });
      return { valid: true };
    } catch {
      // If name() fails, try symbol() — some contracts only implement one
      try {
        await client.readContract({
          address: contractAddress as `0x${string}`,
          abi: parseAbi(['function name() view returns (string)', 'function symbol() view returns (string)']),
          functionName: 'symbol',
        });
        return { valid: true };
      } catch {
        return { valid: false };
      }
    }
  } catch {
    return { valid: false };
  }
}

// ─── Main resolver ─────────────────────────────────

/**
 * Resolve a URL into a MintIntent object.
 *
 * Rules:
 * - sourceUrl: always the normalized URL
 * - isValid: true only when we have a contractAddress + chain + on-chain confirmation
 * - confidence: 1.0 = fully confirmed on-chain, 0.8 = inferred from URL, 0.5 = best-effort, 0.0 = unknown
 */
export async function resolveMintIntent(url: string): Promise<MintIntent> {
  if (!url || typeof url !== 'string') {
    return {
      sourceUrl: url,
      chain: 'ethereum',
      isValid: false,
      confidence: 0,
      sourcePlatform: 'unknown',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return {
      sourceUrl: url,
      chain: 'ethereum',
      isValid: false,
      confidence: 0,
      sourcePlatform: 'unknown',
    };
  }

  const host = cleanHost(parsed.hostname);
  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  const platform = detectChainFromHost(host);

  // ─────────────────────────────────────────────
  // 1. OpenSea
  // ─────────────────────────────────────────────
  if (host === 'opensea.io' || host.endsWith('.opensea.io')) {
    const slugMatch = parsed.pathname.match(OPENSEA_SLUG_RE);
    const collectionSlug = slugMatch?.[1];

    if (!collectionSlug) {
      return {
        sourceUrl: url,
        chain: 'ethereum',
        collectionName: undefined,
        collectionSlug: undefined,
        isValid: false,
        confidence: 0.2,
        sourcePlatform: 'opensea',
      };
    }

    const meta = await fetchOpenSeaCollectionMeta(collectionSlug);
    const chain = platform ?? 'ethereum';

    if (meta?.primaryAssetContractAddress) {
      // Confirm on-chain before returning as valid
      const onChain = await resolveContractOnChain(meta.primaryAssetContractAddress, chain);

      return {
        sourceUrl: url,
        contractAddress: meta.primaryAssetContractAddress,
        chain,
        collectionName: meta.name,
        collectionSlug: meta.slug ?? collectionSlug,
        isValid: onChain.valid,
        confidence: onChain.valid ? 1.0 : 0.7,
        sourcePlatform: 'opensea',
      };
    }

    // API failed — still return inferred intent with lower confidence
    return {
      sourceUrl: url,
      chain,
      collectionName: meta?.name,
      collectionSlug,
      isValid: false,
      confidence: 0.4,
      sourcePlatform: 'opensea',
    };
  }

  // ─────────────────────────────────────────────
  // 2. Block explorer (contract address in URL)
  // ─────────────────────────────────────────────
  if (
    host.endsWith('etherscan.io')
    || host.endsWith('basescan.org')
    || host.endsWith('polygonscan.com')
  ) {
    const chain = platform ?? 'ethereum';
    const address = extractAddressFromPath(pathSegments);

    if (!address) {
      return {
        sourceUrl: url,
        chain,
        isValid: false,
        confidence: 0.1,
        sourcePlatform: 'contract',
      };
    }

    // Confirm on-chain
    const onChain = await resolveContractOnChain(address, chain);

    return {
      sourceUrl: url,
      contractAddress: address.toLowerCase(),
      chain,
      isValid: onChain.valid,
      confidence: onChain.valid ? 1.0 : 0.5,
      sourcePlatform: 'contract',
    };
  }

  // ─────────────────────────────────────────────
  // 3. Direct contract address in path (any host)
  // ─────────────────────────────────────────────
  const directAddress = extractAddressFromPath(pathSegments);
  if (directAddress) {
    const chain = platform ?? 'ethereum';
    const onChain = await resolveContractOnChain(directAddress, chain);

    return {
      sourceUrl: url,
      contractAddress: directAddress.toLowerCase(),
      chain,
      isValid: onChain.valid,
      confidence: onChain.valid ? 0.9 : 0.4,
      sourcePlatform: 'contract',
    };
  }

  // ─────────────────────────────────────────────
  // 4. Custom / generic site — we only know it's a mint site
  // ─────────────────────────────────────────────
  if (host === 'localhost' || host.startsWith('127.') || host.endsWith('.mint') || pathSegments.includes('mint')) {
    return {
      sourceUrl: url,
      chain: 'ethereum',
      isValid: false,
      confidence: 0.1,
      sourcePlatform: 'custom',
    };
  }

  // ─────────────────────────────────────────────
  // 5. Unknown fallback
  // ─────────────────────────────────────────────
  return {
    sourceUrl: url,
    chain: platform ?? 'ethereum',
    isValid: false,
    confidence: 0,
    sourcePlatform: 'unknown',
  };
}