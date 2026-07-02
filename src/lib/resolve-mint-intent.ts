// NOTE: Chain detection logic is also available as a standalone module at
// src/lib/intent/chain-detector.ts — this file will be split further in IMP-05.

/**
 * resolveMintIntent(url)
 *
 * Parses an arbitrary NFT mint URL and returns a normalized MintIntent.
 * Does NOT execute anything — purely parsing + normalization.
 *
 * Supported sources:
 * - OpenSea collection/mint pages (opensea.io)
 * - Direct contract address URLs (etherscan, basescan, polygonscan, arbiscan, …)
 * - Marketplace / launchpad URLs that embed the contract in the path
 *   (Magic Eden, Zora, Blur, Rarible, mint.fun, … — chain read from the path)
 * - A bare contract address pasted on its own ('0xabc…', 'base:0xabc…')
 * - Custom mint sites (detected + flagged as unknown)
 *
 * When no chain is given, the address is probed across every supported chain
 * (ethereum, base, polygon, arbitrum) and resolved on whichever one it exists.
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

export type AnalyzerDebugLogLevel = 'info' | 'success' | 'warning' | 'error';

export type AnalyzerDebugLogEntry = {
  timestamp: string;
  level: AnalyzerDebugLogLevel;
  stage: string;
  message: string;
};

export type AnalyzerDebugLogger = (entry: Omit<AnalyzerDebugLogEntry, 'timestamp'>) => void;

export interface AnalyzerProviderAttempt {
  provider: string;
  status: 'success' | 'failed';
  durationMs: number;
}

export interface AnalyzerTiming {
  stage: string;
  durationMs: number;
}

export interface AnalyzerResolutionTelemetry {
  providerChain: AnalyzerProviderAttempt[];
  timingBreakdown: AnalyzerTiming[];
}

// ─── Chain detection ───────────────────────────────

// Fix #2: was missing arbiscan.io, so pasting an Arbiscan contract URL never
// detected Arbitrum. Kept in sync with src/lib/intent/chain-detector.ts
// (tracked as duplicated logic — see IMP-05 note at the top of this file).
const CHAIN_DOMAINS: Record<string, string> = {
  'etherscan.io': 'ethereum',
  'basescan.org': 'base',
  'polygonscan.com': 'polygon',
  'arbiscan.io': 'arbitrum',
  'solscan.io': 'solana',
};

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ETH_ADDRESS_SCAN_RE = /0x[0-9a-fA-F]{40}/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ─── Chain aliases (path / prefix tokens → canonical chain key) ─────────────
// Marketplaces encode the chain in the URL path in many spellings, e.g.
// magiceden.io/collections/base/0x…, zora.co/collect/base:0x…,
// opensea.io/assets/matic/0x…, rarible.com/collection/polygon/0x…. We map every
// alias we recognise to a canonical chain key so a pasted collection URL
// resolves on the RIGHT chain instead of silently defaulting to Ethereum.
const CHAIN_ALIASES: Record<string, string> = {
  eth: 'ethereum', ethereum: 'ethereum', mainnet: 'ethereum', 'eth-mainnet': 'ethereum',
  base: 'base', 'base-mainnet': 'base',
  polygon: 'polygon', matic: 'polygon', 'polygon-pos': 'polygon', pol: 'polygon',
  arbitrum: 'arbitrum', arb: 'arbitrum', 'arbitrum-one': 'arbitrum', arb1: 'arbitrum',
  solana: 'solana', sol: 'solana',
};

// Chains we can actually validate + mint on (see src/lib/blockchain/chains.ts).
// A bare / ambiguous contract address is probed against these in parallel.
const SUPPORTED_EVM_CHAINS = ['ethereum', 'base', 'polygon', 'arbitrum'] as const;

/** Map a raw token (path segment or prefix) to a canonical chain key, if known. */
function chainFromToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return CHAIN_ALIASES[token.trim().toLowerCase()];
}

/**
 * Detect the chain from any path segment. Handles both standalone segments
 * ('base', 'matic', …) and compound 'chain:address' tokens ('base:0xabc…').
 */
function detectChainFromPath(pathSegments: string[]): string | undefined {
  for (const seg of pathSegments) {
    for (const part of seg.split(':')) {
      const chain = chainFromToken(part);
      if (chain) return chain;
    }
  }
  return undefined;
}

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
    // Marketplaces sometimes glue the chain onto the address as 'base:0xabc…'.
    for (const part of seg.split(':')) {
      if (ETH_ADDRESS_RE.test(part)) {
        return part;
      }
    }
  }
  return undefined;
}

function extractSolanaAddressFromPath(pathSegments: string[]): string | undefined {
  return pathSegments.find((segment) => SOLANA_ADDRESS_RE.test(segment));
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
  chain?: string;
}

function logDebug(logger: AnalyzerDebugLogger | undefined, level: AnalyzerDebugLogLevel, stage: string, message: string) {
  logger?.({ level, stage, message });
}

type OpenSeaAssetPath = {
  chain: string;
  contractAddress: string;
};

function normalizeChain(value: string | undefined): string | undefined {
  const lower = value?.trim().toLowerCase();
  if (!lower) return undefined;
  if (lower === 'eth' || lower === 'ethereum' || lower === 'mainnet') return 'ethereum';
  if (lower === 'matic' || lower === 'polygon') return 'polygon';
  if (lower === 'sol' || lower === 'solana') return 'solana';
  if (lower === 'base') return 'base';
  return lower;
}

function parseOpenSeaCollectionSlug(pathSegments: string[]) {
  const collectionIndex = pathSegments.findIndex((segment) => segment === 'collection' || segment === 'collections');
  const slug = collectionIndex >= 0 ? pathSegments[collectionIndex + 1] : undefined;
  return slug ? decodeURIComponent(slug).toLowerCase() : undefined;
}

function parseOpenSeaAssetPath(pathSegments: string[]): OpenSeaAssetPath | undefined {
  const assetIndex = pathSegments.findIndex((segment) => segment === 'assets' || segment === 'asset');
  if (assetIndex < 0) return undefined;

  const chain = normalizeChain(pathSegments[assetIndex + 1]);
  const contractAddress = pathSegments[assetIndex + 2];
  if (!chain || !contractAddress || !ETH_ADDRESS_RE.test(contractAddress)) return undefined;
  return { chain, contractAddress: contractAddress.toLowerCase() };
}

function normalizeOpenSeaApiContract(collection: Record<string, unknown>, slug: string): OpenSeaCollectionMeta | undefined {
  const contracts = Array.isArray(collection.contracts) ? collection.contracts : [];
  const primaryAssetContract = collection.primary_asset_contract;
  const primaryAssetContractCamel = collection.primaryAssetContract;
  const firstContract = contracts.find((contract) => contract && typeof contract === 'object') as Record<string, unknown> | undefined;
  const primary = [primaryAssetContract, primaryAssetContractCamel, firstContract]
    .find((contract) => contract && typeof contract === 'object') as Record<string, unknown> | undefined;
  const address = typeof primary?.address === 'string'
    ? primary.address
    : typeof collection.primary_asset_contract_address === 'string'
      ? collection.primary_asset_contract_address
      : typeof collection.primaryAssetContractAddress === 'string'
        ? collection.primaryAssetContractAddress
        : undefined;

  if (!address || !ETH_ADDRESS_RE.test(address)) return undefined;

  return {
    name: typeof collection.name === 'string' ? collection.name : slug,
    slug: typeof collection.slug === 'string' ? collection.slug : slug,
    primaryAssetContractAddress: address.toLowerCase(),
    chain: normalizeChain(typeof primary?.chain === 'string' ? primary.chain : typeof collection.chain === 'string' ? collection.chain : undefined),
  };
}

/**
 * Fetch minimal collection metadata from OpenSea API v2.
 * Uses OPENSEA_API_KEY if available; falls back to unauthenticated public endpoint.
 *
 * No UI assumptions — only metadata for normalization.
 */
async function fetchOpenSeaCollectionMeta(slug: string, logger?: AnalyzerDebugLogger, signal?: AbortSignal): Promise<OpenSeaCollectionMeta | undefined> {
  const apiKey = process.env.OPENSEA_API_KEY;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) {
    headers['X-API-KEY'] = apiKey;
  }

  const urls = [
    `https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`,
    `https://api.opensea.io/v2/collection/${encodeURIComponent(slug)}`,
  ];

  try {
    logDebug(logger, 'info', 'discovery', 'Using OpenSea API');
    for (const url of urls) {
      const res = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(5_000) });
      if (!res.ok) {
        logDebug(logger, 'warning', 'discovery', `OpenSea API returned ${res.status}`);
        continue;
      }
      const json = await res.json();
      const collection = json?.collection && typeof json.collection === 'object'
        ? json.collection
        : json?.data?.collection
          ? json.data.collection
          : json;
      if (!collection) continue;
      const meta = normalizeOpenSeaApiContract(collection, slug);
      if (meta) {
        logDebug(logger, 'success', 'discovery', 'OpenSea API succeeded');
        return meta;
      }
    }
    logDebug(logger, 'warning', 'discovery', 'OpenSea API returned empty contract metadata');
    return undefined;
  } catch (error) {
    // Network error, timeout, or 404 — treat as unknown
    logDebug(logger, 'warning', 'discovery', `OpenSea API failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function extractAddressFromText(text: string) {
  return text.match(ETH_ADDRESS_SCAN_RE)?.[0]?.toLowerCase();
}

function extractChainFromText(text: string) {
  return normalizeChain(text.match(/\b(ethereum|base|polygon|matic|solana)\b/i)?.[1]);
}

async function fetchOpenSeaPageMeta(url: string, slug: string, logger?: AnalyzerDebugLogger, signal?: AbortSignal): Promise<OpenSeaCollectionMeta | undefined> {
  try {
    logDebug(logger, 'info', 'discovery', 'Using Direct Fetch for OpenSea page metadata');
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'AutoMintAnalyzer/1.0',
      },
      signal: signal ?? AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      logDebug(logger, 'warning', 'discovery', `Direct Fetch returned ${res.status}`);
      return undefined;
    }

    const html = await res.text();
    const address = extractAddressFromText(html);
    if (!address) {
      logDebug(logger, 'warning', 'discovery', 'Direct Fetch returned no contract address');
      return undefined;
    }
    const title = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<title>([^<]+)<\/title>/i)?.[1];

    logDebug(logger, 'success', 'discovery', 'Direct Fetch succeeded');
    return {
      name: title?.replace(/\s*[-|]\s*OpenSea.*$/i, '').trim() || slug,
      slug,
      primaryAssetContractAddress: address,
      chain: extractChainFromText(html),
    };
  } catch (error) {
    logDebug(logger, 'warning', 'discovery', `Direct Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

async function fetchFirecrawlOpenSeaMeta(url: string, slug: string, logger?: AnalyzerDebugLogger): Promise<OpenSeaCollectionMeta | undefined> {
  try {
    logDebug(logger, 'info', 'discovery', 'Using Firecrawl');
    const { discoverWithFirecrawl } = await import('@/lib/services/firecrawl.provider');
    const result = await discoverWithFirecrawl(url);
    if (!result.contract || !ETH_ADDRESS_RE.test(result.contract)) {
      logDebug(logger, 'warning', 'discovery', 'Firecrawl returned empty contract response');
      return undefined;
    }

    logDebug(logger, 'success', 'discovery', 'Firecrawl succeeded');
    return {
      name: result.collectionName ?? slug,
      slug,
      primaryAssetContractAddress: result.contract.toLowerCase(),
      chain: normalizeChain(result.chain),
    };
  } catch (error) {
    logDebug(logger, 'warning', 'discovery', `Firecrawl failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}



async function resolveOpenSeaCollectionMeta(url: string, slug: string, logger?: AnalyzerDebugLogger, telemetry?: AnalyzerResolutionTelemetry) {
  async function runParallelStage(resolvers: Array<{ name: string; run: (signal?: AbortSignal) => Promise<OpenSeaCollectionMeta | undefined> }>) {
    logDebug(logger, 'info', 'discovery', 'Parallel execution started');
    const controllers = resolvers.map(() => new AbortController());
    const attempts = resolvers.map((resolver, index) => {
      const startedAt = Date.now();
      return resolver.run(controllers[index].signal)
        .then((result) => ({
          name: resolver.name,
          result,
          durationMs: Date.now() - startedAt,
        }))
        .catch((error) => {
          if (controllers[index].signal.aborted) {
            logDebug(logger, 'warning', 'discovery', `Provider cancelled: ${resolver.name}`);
          } else {
            logDebug(logger, 'warning', 'discovery', `${resolver.name} failed: ${error instanceof Error ? error.message : String(error)}`);
          }
          return {
            name: resolver.name,
            result: undefined,
            durationMs: Date.now() - startedAt,
          };
        });
    });

    return new Promise<OpenSeaCollectionMeta | undefined>((resolve) => {
      let remaining = attempts.length;
      let settled = false;
      attempts.forEach((attempt, index) => {
        void attempt.then((entry) => {
          const status = entry.result?.primaryAssetContractAddress ? 'success' : 'failed';
          telemetry?.providerChain.push({ provider: entry.name, status, durationMs: entry.durationMs });
          telemetry?.timingBreakdown.push({ stage: entry.name === 'OpenSea API' ? 'OpenSea Resolution' : entry.name, durationMs: entry.durationMs });
          logDebug(logger, status === 'success' ? 'success' : 'warning', 'discovery', `${entry.name} completed in ${entry.durationMs}ms`);

          if (!settled && entry.result?.primaryAssetContractAddress) {
            settled = true;
            controllers.forEach((controller, controllerIndex) => {
              if (controllerIndex !== index && !controller.signal.aborted) {
                controller.abort();
                logDebug(logger, 'warning', 'discovery', `Provider cancelled: ${resolvers[controllerIndex].name}`);
              }
            });
            resolve(entry.result);
            return;
          }

          remaining -= 1;
          if (!settled && remaining === 0) {
            settled = true;
            resolve(undefined);
          }
        });
      });
    });
  }

  const fastResult = await runParallelStage([
    { name: 'OpenSea API', run: (signal) => fetchOpenSeaCollectionMeta(slug, logger, signal) },
    { name: 'Direct Fetch', run: (signal) => fetchOpenSeaPageMeta(url, slug, logger, signal) },
  ]);
  if (fastResult) {
    logDebug(logger, 'warning', 'discovery', 'Provider cancelled: Firecrawl');
    return fastResult;
  }

  logDebug(logger, 'info', 'discovery', 'Switching to fallback provider: Firecrawl');
  const fallbackResult = await runParallelStage([
    { name: 'Firecrawl', run: () => fetchFirecrawlOpenSeaMeta(url, slug, logger) },
  ]);
  if (fallbackResult) return fallbackResult;

  logDebug(logger, 'error', 'contract_resolution', 'No contract found');
  return undefined;
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
async function resolveContractWithTiming(
  contractAddress: string,
  chain: string,
  telemetry?: AnalyzerResolutionTelemetry,
) {
  const startedAt = Date.now();
  const result = await resolveContractOnChain(contractAddress, chain);
  telemetry?.timingBreakdown.push({ stage: 'Contract Validation', durationMs: Date.now() - startedAt });
  return result;
}

/**
 * Probe a contract address across all supported chains (preferred chain first)
 * and return the first chain where an on-chain lookup confirms it exists.
 *
 * This is what makes "just paste a bare contract address / a marketplace URL
 * with no chain hint" work: instead of forcing the user to tell us the chain,
 * we find it. All probes run in parallel; preference order is preserved when
 * more than one chain would match (rare). Returns { chain, valid:true } on the
 * first hit, else the preferred (or Ethereum) chain with valid:false.
 */
async function resolveContractAcrossChains(
  contractAddress: string,
  preferredChain: string | undefined,
  telemetry?: AnalyzerResolutionTelemetry,
): Promise<{ chain: string; valid: boolean }> {
  const ordered = [
    ...(preferredChain ? [preferredChain] : []),
    ...SUPPORTED_EVM_CHAINS.filter((c) => c !== preferredChain),
  ];
  const startedAt = Date.now();
  const results = await Promise.all(
    ordered.map(async (chain) => ({ chain, ...(await resolveContractOnChain(contractAddress, chain)) })),
  );
  telemetry?.timingBreakdown.push({ stage: 'Multi-chain Validation', durationMs: Date.now() - startedAt });
  // `ordered` already has preferredChain first, so this honours preference.
  const hit = ordered
    .map((c) => results.find((r) => r.chain === c))
    .find((r): r is { chain: string; valid: boolean } => Boolean(r?.valid));
  if (hit) return { chain: hit.chain, valid: true };
  return { chain: preferredChain ?? 'ethereum', valid: false };
}

export async function resolveMintIntent(
  url: string,
  logger?: AnalyzerDebugLogger,
  telemetry?: AnalyzerResolutionTelemetry,
): Promise<MintIntent> {
  if (!url || typeof url !== 'string') {
    return {
      sourceUrl: url,
      chain: 'ethereum',
      isValid: false,
      confidence: 0,
      sourcePlatform: 'unknown',
    };
  }

  const trimmed = url.trim();

  // ───────────────────────────────────────────────────────────────────────
  // 0. Bare contract address (not a URL at all)
  //    Accepts '0xabc…', 'base:0xabc…', 'polygon/0xabc…', or a Solana mint.
  //    Lets the user paste JUST the address with no explorer/marketplace link.
  // ───────────────────────────────────────────────────────────────────────
  if (!/^https?:\/\//i.test(trimmed)) {
    const prefixMatch = trimmed.match(/^([a-z0-9-]+)\s*[:/]\s*(0x[0-9a-fA-F]{40})$/i);
    const bareEth = ETH_ADDRESS_RE.test(trimmed) ? trimmed : prefixMatch?.[2];
    if (bareEth) {
      const preferred = chainFromToken(prefixMatch?.[1]);
      logDebug(logger, 'success', 'contract_resolution', `Contract address pasted directly: ${bareEth.toLowerCase()}`);
      const { chain, valid } = await resolveContractAcrossChains(bareEth, preferred, telemetry);
      telemetry?.providerChain.push({ provider: 'Direct Address', status: valid ? 'success' : 'failed', durationMs: 0 });
      logDebug(logger, valid ? 'success' : 'warning', 'contract_resolution', valid ? `Validated on ${chain}` : 'On-chain validation failed on all supported chains');
      return {
        sourceUrl: url,
        contractAddress: bareEth.toLowerCase(),
        chain,
        isValid: valid,
        confidence: valid ? 0.95 : 0.4,
        sourcePlatform: 'contract',
      };
    }
    if (SOLANA_ADDRESS_RE.test(trimmed)) {
      logDebug(logger, 'success', 'contract_resolution', `Solana address pasted directly: ${trimmed}`);
      return {
        sourceUrl: url,
        contractAddress: trimmed,
        chain: 'solana',
        isValid: false, // Solana minting is not supported by the EVM client
        confidence: 0.5,
        sourcePlatform: 'contract',
      };
    }
  }

  let parsed: URL;
  try {
    // Accept URLs pasted without a scheme (e.g. 'magiceden.io/…') by assuming https.
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
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
    const asset = parseOpenSeaAssetPath(pathSegments);
    if (asset) {
      logDebug(logger, 'success', 'contract_resolution', `Contract detected: ${asset.contractAddress}`);
      logDebug(logger, 'success', 'contract_resolution', `Chain detected: ${asset.chain}`);
      const startedAt = Date.now();
      const onChain = await resolveContractWithTiming(asset.contractAddress, asset.chain, telemetry);
      telemetry?.providerChain.push({ provider: 'OpenSea Asset', status: 'success', durationMs: Date.now() - startedAt });
      logDebug(logger, onChain.valid ? 'success' : 'warning', 'contract_resolution', onChain.valid ? 'On-chain validation passed' : 'On-chain validation failed');

      return {
        sourceUrl: url,
        contractAddress: asset.contractAddress,
        chain: asset.chain,
        isValid: onChain.valid,
        confidence: onChain.valid ? 1.0 : 0.7,
        sourcePlatform: 'opensea',
      };
    }

    const collectionSlug = parseOpenSeaCollectionSlug(pathSegments);

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

    logDebug(logger, 'success', 'contract_resolution', `Collection slug detected: ${collectionSlug}`);
    logDebug(logger, 'info', 'contract_resolution', 'Resolving contract address');
    const meta = await resolveOpenSeaCollectionMeta(url, collectionSlug, logger, telemetry);
    const chain = meta?.chain ?? platform ?? 'ethereum';

    if (meta?.primaryAssetContractAddress) {
      logDebug(logger, 'success', 'contract_resolution', `Contract detected: ${meta.primaryAssetContractAddress}`);
      logDebug(logger, 'success', 'contract_resolution', `Chain detected: ${chain}`);
      // Confirm on-chain before returning as valid
      const onChain = await resolveContractWithTiming(meta.primaryAssetContractAddress, chain, telemetry);
      logDebug(logger, onChain.valid ? 'success' : 'warning', 'contract_resolution', onChain.valid ? 'On-chain validation passed' : 'On-chain validation failed');

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
    || host.endsWith('arbiscan.io')
    || host.endsWith('solscan.io')
  ) {
    const chain = platform ?? 'ethereum';
    const address = chain === 'solana' ? extractSolanaAddressFromPath(pathSegments) : extractAddressFromPath(pathSegments);

    if (!address) {
      return {
        sourceUrl: url,
        chain,
        isValid: false,
        confidence: 0.1,
        sourcePlatform: 'contract',
      };
    }

    if (chain === 'solana') {
      telemetry?.providerChain.push({ provider: 'Explorer', status: 'success', durationMs: 0 });
      logDebug(logger, 'success', 'contract_resolution', `Contract detected: ${address}`);
      logDebug(logger, 'success', 'contract_resolution', `Chain detected: ${chain}`);
      return {
        sourceUrl: url,
        contractAddress: address,
        chain,
        isValid: true,
        confidence: 0.8,
        sourcePlatform: 'contract',
      };
    }

    // Confirm on-chain
    logDebug(logger, 'success', 'contract_resolution', `Contract detected: ${address.toLowerCase()}`);
    logDebug(logger, 'success', 'contract_resolution', `Chain detected: ${chain}`);
    const startedAt = Date.now();
    const onChain = await resolveContractWithTiming(address, chain, telemetry);
    telemetry?.providerChain.push({ provider: 'Explorer', status: onChain.valid ? 'success' : 'failed', durationMs: Date.now() - startedAt });
    logDebug(logger, onChain.valid ? 'success' : 'warning', 'contract_resolution', onChain.valid ? 'On-chain validation passed' : 'On-chain validation failed');

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
    // Prefer an explicit chain hint — explorer host → path token ('base',
    // 'matic', 'base:0x…') → none. When there's no hint we probe every supported
    // chain so a marketplace/launchpad URL (Magic Eden, Zora, Blur, Rarible, …)
    // resolves on whichever chain the contract actually lives on.
    const preferred = platform ?? detectChainFromPath(pathSegments);
    logDebug(logger, 'success', 'contract_resolution', `Contract detected: ${directAddress.toLowerCase()}`);
    const { chain, valid } = await resolveContractAcrossChains(directAddress, preferred, telemetry);
    logDebug(logger, 'success', 'contract_resolution', `Chain detected: ${chain}`);
    telemetry?.providerChain.push({ provider: 'Direct Contract', status: valid ? 'success' : 'failed', durationMs: 0 });
    logDebug(logger, valid ? 'success' : 'warning', 'contract_resolution', valid ? `On-chain validation passed on ${chain}` : 'On-chain validation failed on all supported chains');

    return {
      sourceUrl: url,
      contractAddress: directAddress.toLowerCase(),
      chain,
      isValid: valid,
      confidence: valid ? 0.9 : 0.4,
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
