import 'server-only';

import type { CollectionMetadata } from '@/lib/blockchain/collections';
import type { AnalyzerDebugLogLevel, AnalyzerTiming, MintIntent } from '@/lib/resolve-mint-intent';

export type MarketStatus = 'Hot' | 'Active' | 'Stable' | 'Declining' | 'Inactive';

export type AnalyzerCollectionIntelligence = {
  collectionName: string;
  description: string | null;
  creator: string | null;
  verified: boolean | null;
  contractAddress: string | null;
  chain: string;
  tokenStandard: string;
  floorPrice: string | null;
  volume: string | null;
  ownerCount: number | null;
  itemCount: number | null;
  marketCap: string | null;
  marketStatus: MarketStatus;
  healthScore: number;
  healthSummary: string;
  sources: string[];
};

type MarketProviderResult = Partial<AnalyzerCollectionIntelligence> & {
  source: string;
  recentSalesCount?: number | null;
  floorChangePercent?: number | null;
};

const RESERVOIR_HOSTS: Record<string, string> = {
  ethereum: 'https://api.reservoir.tools',
  base: 'https://api-base.reservoir.tools',
  polygon: 'https://api-polygon.reservoir.tools',
};

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function optionalString(value: unknown) {
  return stringValue(value) ?? undefined;
}

function boolValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (['true', 'verified', 'safelist_verified'].includes(value.toLowerCase())) return true;
    if (['false', 'not_requested', 'disabled'].includes(value.toLowerCase())) return false;
  }
  return null;
}

function formatEth(value: unknown) {
  const number = numericValue(value);
  if (number === null || number <= 0) return null;
  return `${Number(number.toFixed(number >= 10 ? 2 : 4))} ETH`;
}

function mergeResults(base: AnalyzerCollectionIntelligence, result: MarketProviderResult): AnalyzerCollectionIntelligence {
  return {
    ...base,
    collectionName: result.collectionName ?? base.collectionName,
    description: result.description ?? base.description,
    creator: result.creator ?? base.creator,
    verified: result.verified ?? base.verified,
    floorPrice: result.floorPrice ?? base.floorPrice,
    volume: result.volume ?? base.volume,
    ownerCount: result.ownerCount ?? base.ownerCount,
    itemCount: result.itemCount ?? base.itemCount,
    marketCap: result.marketCap ?? base.marketCap,
    sources: base.sources.includes(result.source) ? base.sources : [...base.sources, result.source],
  };
}

function classifyMarketStatus(params: {
  volume: string | null;
  ownerCount: number | null;
  floorPrice: string | null;
  recentSalesCount?: number | null;
  floorChangePercent?: number | null;
}): MarketStatus {
  const volume = numericValue(params.volume?.replace(/[^\d.]/g, ''));
  const floor = numericValue(params.floorPrice?.replace(/[^\d.]/g, ''));
  const sales = params.recentSalesCount ?? 0;
  const floorChange = params.floorChangePercent ?? null;

  if ((volume ?? 0) >= 1_000 || sales >= 100 || (floorChange !== null && floorChange >= 20)) return 'Hot';
  if ((volume ?? 0) >= 100 || sales >= 20 || (params.ownerCount ?? 0) >= 2_000) return 'Active';
  if ((volume ?? 0) > 0 || (floor ?? 0) > 0 || (params.ownerCount ?? 0) >= 250) return 'Stable';
  if (floorChange !== null && floorChange <= -20) return 'Declining';
  return 'Inactive';
}

function scoreHealth(params: AnalyzerCollectionIntelligence) {
  let score = 35;
  const summary: string[] = [];

  if (params.verified) {
    score += 15;
    summary.push('Verified collection');
  } else if (params.verified === false) {
    score -= 8;
    summary.push('Unverified collection');
  }

  if ((params.ownerCount ?? 0) >= 2_000) {
    score += 16;
    summary.push('Strong holder distribution');
  } else if ((params.ownerCount ?? 0) > 0 && (params.itemCount ?? 0) > 0 && (params.ownerCount ?? 0) / Math.max(params.itemCount ?? 1, 1) < 0.2) {
    score -= 12;
    summary.push('High owner concentration');
  }

  if (params.floorPrice) score += 8;
  else summary.push('Floor price unavailable');

  if (params.volume) {
    score += 12;
    summary.push('Market volume available');
  } else {
    score -= 8;
    summary.push('Low liquidity');
  }

  if (params.marketStatus === 'Hot') score += 14;
  if (params.marketStatus === 'Active') score += 10;
  if (params.marketStatus === 'Declining') score -= 10;
  if (params.marketStatus === 'Inactive') score -= 12;

  const healthScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    healthScore,
    healthSummary: summary.length ? summary.join('. ') : 'Market health could not be fully determined from available signals',
  };
}

function openSeaSlug(intent: MintIntent) {
  if (intent.collectionSlug) return intent.collectionSlug;
  try {
    const url = new URL(intent.sourceUrl);
    if (!url.hostname.toLowerCase().includes('opensea.io')) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const index = segments.findIndex((segment) => segment === 'collection' || segment === 'collections');
    return index >= 0 ? segments[index + 1] ?? null : null;
  } catch {
    return null;
  }
}

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(7_500),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

async function fetchOpenSeaIntelligence(intent: MintIntent): Promise<MarketProviderResult | null> {
  const slug = openSeaSlug(intent);
  if (!slug) return null;

  const headers: Record<string, string> = {};
  if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;

  const [collectionJson, statsJson] = await Promise.allSettled([
    fetchJson(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`, headers),
    fetchJson(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}/stats`, headers),
  ]);

  const rawCollection = collectionJson.status === 'fulfilled' ? collectionJson.value as Record<string, unknown> : {};
  const collection = rawCollection.collection && typeof rawCollection.collection === 'object'
    ? rawCollection.collection as Record<string, unknown>
    : rawCollection;
  const rawStats = statsJson.status === 'fulfilled' ? statsJson.value as Record<string, unknown> : {};
  const stats = rawStats.total && typeof rawStats.total === 'object'
    ? rawStats.total as Record<string, unknown>
    : rawStats;

  if (!Object.keys(collection).length && !Object.keys(stats).length) return null;

  const contracts = Array.isArray(collection.contracts) ? collection.contracts : [];
  const firstContract = contracts.find((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);

  return {
    source: 'OpenSea',
    collectionName: optionalString(collection.name),
    description: stringValue(collection.description),
    creator: stringValue(collection.creator) ?? stringValue(collection.owner),
    verified: boolValue(collection.safelist_status) ?? boolValue(collection.is_verified),
    contractAddress: stringValue(firstContract?.address),
    floorPrice: formatEth(stats.floor_price),
    volume: formatEth(stats.volume ?? stats.total_volume),
    ownerCount: numericValue(stats.num_owners ?? collection.owner_count),
    itemCount: numericValue(stats.total_supply ?? collection.total_supply),
    marketCap: formatEth(stats.market_cap),
    recentSalesCount: numericValue(stats.sales ?? stats.num_sales),
  };
}

async function fetchReservoirIntelligence(intent: MintIntent): Promise<MarketProviderResult | null> {
  const host = RESERVOIR_HOSTS[intent.chain];
  if (!host || !intent.contractAddress) return null;
  const json = await fetchJson(`${host}/collections/v7?id=${encodeURIComponent(intent.contractAddress)}`) as Record<string, unknown>;
  const collections = Array.isArray(json.collections) ? json.collections : [];
  const collection = collections.find((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  if (!collection) return null;

  const floorAsk = typeof collection.floorAsk === 'object' && collection.floorAsk !== null ? collection.floorAsk as Record<string, unknown> : {};
  const price = typeof floorAsk.price === 'object' && floorAsk.price !== null ? floorAsk.price as Record<string, unknown> : {};
  const amount = typeof price.amount === 'object' && price.amount !== null ? price.amount as Record<string, unknown> : {};
  const volume = typeof collection.volume === 'object' && collection.volume !== null ? collection.volume as Record<string, unknown> : {};
  const floorSale = typeof collection.floorSale === 'object' && collection.floorSale !== null ? collection.floorSale as Record<string, unknown> : {};

  return {
    source: 'Reservoir',
    collectionName: optionalString(collection.name),
    description: stringValue(collection.description),
    creator: stringValue(collection.creator),
    verified: boolValue(collection.openseaVerificationStatus),
    floorPrice: formatEth(amount.native ?? amount.decimal),
    volume: formatEth(volume.allTime ?? volume['30day'] ?? volume['7day'] ?? volume['1day']),
    ownerCount: numericValue(collection.ownerCount),
    itemCount: numericValue(collection.tokenCount),
    marketCap: formatEth(collection.marketCap),
    recentSalesCount: numericValue(floorSale.count ?? collection.salesCount),
    floorChangePercent: numericValue(collection.floorAskPercentChange),
  };
}

function alchemyNetwork(chain: string) {
  if (chain === 'base') return 'base-mainnet';
  if (chain === 'polygon') return 'polygon-mainnet';
  return 'eth-mainnet';
}

async function fetchAlchemyIntelligence(intent: MintIntent): Promise<MarketProviderResult | null> {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey || !intent.contractAddress) return null;
  const network = alchemyNetwork(intent.chain);
  const json = await fetchJson(`https://${network}.g.alchemy.com/nft/v3/${apiKey}/getContractMetadata?contractAddress=${encodeURIComponent(intent.contractAddress)}`) as Record<string, unknown>;
  const metadata = typeof json.contractMetadata === 'object' && json.contractMetadata !== null
    ? json.contractMetadata as Record<string, unknown>
    : json;
  const openSea = typeof metadata.openSea === 'object' && metadata.openSea !== null ? metadata.openSea as Record<string, unknown> : {};

  return {
    source: 'Alchemy',
    collectionName: optionalString(metadata.name ?? openSea.collectionName),
    description: stringValue(openSea.description),
    creator: stringValue(openSea.twitterUsername ?? openSea.discordUrl),
    floorPrice: formatEth(openSea.floorPrice),
    itemCount: numericValue(metadata.totalSupply),
  };
}

export async function fetchCollectionIntelligence(params: {
  intent: MintIntent;
  metadata: Omit<CollectionMetadata, 'totalSupply'> & { totalSupply: string };
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}): Promise<AnalyzerCollectionIntelligence> {
  const base: AnalyzerCollectionIntelligence = {
    collectionName: params.metadata.name ?? params.intent.collectionName ?? params.intent.collectionSlug ?? 'Unknown Collection',
    description: null,
    creator: null,
    verified: null,
    contractAddress: params.intent.contractAddress ?? null,
    chain: params.intent.chain,
    tokenStandard: params.metadata.tokenStandard,
    floorPrice: null,
    volume: null,
    ownerCount: null,
    itemCount: numericValue(params.metadata.totalSupply),
    marketCap: null,
    marketStatus: 'Inactive',
    healthScore: 0,
    healthSummary: 'Market metrics unavailable',
    sources: ['On-chain'],
  };

  params.log('info', 'market_intelligence', 'Fetching collection metrics');
  params.log('info', 'market_intelligence', 'Fetching owner metrics');
  params.log('info', 'market_intelligence', 'Fetching floor price');
  params.log('info', 'market_intelligence', 'Fetching volume');

  const startedAt = Date.now();
  const providerResults = await Promise.allSettled([
    fetchOpenSeaIntelligence(params.intent),
    fetchReservoirIntelligence(params.intent),
    fetchAlchemyIntelligence(params.intent),
  ]);
  params.timingBreakdown.push({ stage: 'Market Intelligence', durationMs: Date.now() - startedAt });

  let intelligence = base;
  let latestRecentSales: number | null = null;
  let latestFloorChange: number | null = null;

  for (const providerResult of providerResults) {
    if (providerResult.status === 'rejected') {
      params.log('warning', 'market_intelligence', `Market provider failed: ${providerResult.reason instanceof Error ? providerResult.reason.message : String(providerResult.reason)}`);
      continue;
    }
    if (!providerResult.value) continue;
    intelligence = mergeResults(intelligence, providerResult.value);
    latestRecentSales = providerResult.value.recentSalesCount ?? latestRecentSales;
    latestFloorChange = providerResult.value.floorChangePercent ?? latestFloorChange;
  }

  const marketStatus = classifyMarketStatus({
    volume: intelligence.volume,
    ownerCount: intelligence.ownerCount,
    floorPrice: intelligence.floorPrice,
    recentSalesCount: latestRecentSales,
    floorChangePercent: latestFloorChange,
  });
  intelligence = { ...intelligence, marketStatus };
  intelligence = { ...intelligence, ...scoreHealth(intelligence) };

  params.log('success', 'market_intelligence', 'Market analysis complete');
  return intelligence;
}
