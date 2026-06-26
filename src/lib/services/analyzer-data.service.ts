import 'server-only';

// ── analyzer-data.service.ts ──────────────────────────────────────────────────
// Handles on-chain data aggregation (NFTScan, Moralis, GoPlus) and
// risk/history persistence.  Called by the thin orchestrator.
// ─────────────────────────────────────────────────────────────────────────────

import { getCollectionMetadata, type CollectionMetadata } from '@/lib/blockchain/collections';
import { type MintIntent } from '@/lib/resolve-mint-intent';
import { addBreadcrumb } from '@/lib/observability/sentry';
import { analyzeAnalyzerRisk, type AnalyzerRiskAnalysis } from '@/lib/services/risk.service';
import { fetchCollectionIntelligence, type AnalyzerCollectionIntelligence } from '@/lib/services/analyzer-market-intelligence.service';
import {
  ANALYZER_CACHE_KEYS,
  ANALYZER_CACHE_TTL,
  cacheHitRate,
  createAnalyzerCacheStats,
  readAnalyzerCache,
  writeAnalyzerCache,
  type AnalyzerCacheStats,
} from '@/lib/services/analyzer-cache.service';
import { analyzerHistory } from '@/drizzle/schema';
import { getDb } from '@/lib/db';
import { getNFTCollection, getNFTTrades, getNFTStatistics } from '@/lib/services/nftscan.service';
import { getNFTCollection as getMoralisCollection, getNFTTrades as getMoralisTrades } from '@/lib/services/moralis.service';
import { checkTokenSecurity } from '@/lib/services/goplus-security.service';
import type { AnalyzerSocials, AnalyzerTiming } from '@/lib/services/analyzer-resolver.service';
import { runTimed } from '@/lib/services/analyzer-resolver.service';

// ── Types ─────────────────────────────────────────────────────────────────────

type AnalyzerDebugLogLevel = 'info' | 'success' | 'warning' | 'error';
type CachedCollectionMetadata = Omit<CollectionMetadata, 'totalSupply'> & { totalSupply: string };

export type BlockchainDiscoveryResult = {
  collectionData: { contractAddress: string; name: string; symbol: string; contractType: string; ownerCount: number; totalSupply: number; totalVolume: string; floorPrice: string; floorPriceSymbol: string; logo: string; description: string; website: string; twitter: string; discord: string; telegram: string; isVerified: boolean; } | null;
  trades: unknown[] | null;
  statistics: { totalHolderCount: number; totalTradeCount: number; [key: string]: unknown } | null;
  securityCheck: { riskScore: number; riskFactors: string[]; [key: string]: unknown } | null;
};

export type AnalyzerPerformanceMetrics = {
  cacheHitRate: number;
  averageAnalysisDurationMs: number;
  fastestProvider: string | null;
  slowestProvider: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function logCacheResult(
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void,
  hit: boolean,
  label: string,
) {
  log(hit ? 'success' : 'info', 'cache', `${hit ? 'Cache hit' : 'Cache miss'}: ${label}`);
}

export function serializeMetadata(metadata: CollectionMetadata): CachedCollectionMetadata {
  return { ...metadata, totalSupply: metadata.totalSupply.toString() };
}

export function deserializeMetadata(metadata: CachedCollectionMetadata): CollectionMetadata {
  return { ...metadata, totalSupply: BigInt(metadata.totalSupply) };
}

export function rpcProviderLabel(provider: 'ALCHEMY' | 'QUICKNODE' | null) {
  if (provider === 'ALCHEMY') return 'Alchemy';
  if (provider === 'QUICKNODE') return 'QuickNode';
  return null;
}

export function selectedProviderFromChain(
  input: string,
  intent: MintIntent,
  providerChain: import('@/lib/resolve-mint-intent').AnalyzerProviderAttempt[],
) {
  const trimmed = input.trim();
  if (/^0x[a-f0-9]{40}$/i.test(trimmed)) return 'Direct Contract';
  const successfulProvider = providerChain.find((entry) => entry.status === 'success');
  if (successfulProvider) return successfulProvider.provider;
  if (intent.sourcePlatform === 'contract') return 'Explorer';
  if (intent.sourcePlatform === 'unknown') return 'Unknown';
  return intent.sourcePlatform;
}

export function deriveAnalyzerScores(result: Pick<AnalyzerResult, 'intent' | 'mintFunction' | 'mintState' | 'riskAnalysis'>) {
  const confidence = Math.round(result.intent.confidence * 100);
  const functionConfidence = Math.round(result.mintFunction.confidence * 100);
  const liveBonus = result.mintState.status === 'LIVE' ? 12 : 0;
  const readiness = Math.min(96, Math.max(24, Math.round((confidence + functionConfidence) / 2) + liveBonus));
  const risk = result.riskAnalysis.riskScore;
  const opportunity = Math.min(98, Math.max(30, readiness - risk / 4));
  return { opportunity: Math.round(opportunity), readiness };
}

export function derivePerformanceMetrics(params: {
  cacheStats: AnalyzerCacheStats;
  analysisDurationMs: number;
  providerChain: import('@/lib/resolve-mint-intent').AnalyzerProviderAttempt[];
}): AnalyzerPerformanceMetrics {
  const ordered = [...params.providerChain].sort((a, b) => a.durationMs - b.durationMs);
  return {
    cacheHitRate: cacheHitRate(params.cacheStats),
    averageAnalysisDurationMs: params.analysisDurationMs,
    fastestProvider: ordered[0]?.provider ?? null,
    slowestProvider: ordered.at(-1)?.provider ?? null,
  };
}

// ── Cached collection metadata ────────────────────────────────────────────────

export async function getCachedCollectionMetadata(params: {
  contractAddress: string;
  chain: string;
  cacheStats: AnalyzerCacheStats;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
}) {
  const key = ANALYZER_CACHE_KEYS.collectionMetadata(params.contractAddress, params.chain);
  const cached = await readAnalyzerCache<CachedCollectionMetadata>(key, params.cacheStats);
  logCacheResult(params.log, Boolean(cached), 'Collection Metadata');
  if (cached) return deserializeMetadata(cached);
  const fresh = await getCollectionMetadata(params.contractAddress, params.chain);
  await writeAnalyzerCache(key, serializeMetadata(fresh), ANALYZER_CACHE_TTL.collectionMetadata);
  return fresh;
}

// ── Blockchain discovery (NFTScan / Moralis / GoPlus) ────────────────────────

export async function runBlockchainDiscoveryWithCache(params: {
  contractAddress: string;
  chain: string;
  enabled: boolean;
  cacheStats: AnalyzerCacheStats;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}): Promise<BlockchainDiscoveryResult> {
  const key = ANALYZER_CACHE_KEYS.discoveryResults(`blockchain_${params.contractAddress}_${params.chain}`);
  const cached = await readAnalyzerCache<BlockchainDiscoveryResult>(key, params.cacheStats);
  logCacheResult(params.log, Boolean(cached), 'Blockchain Discovery Results');
  if (cached) return cached;
  const fresh = await runBlockchainDiscovery(params);
  await writeAnalyzerCache(key, fresh, ANALYZER_CACHE_TTL.discoveryResults);
  return fresh;
}

async function runBlockchainDiscovery(params: {
  contractAddress: string;
  chain: string;
  enabled: boolean;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}): Promise<BlockchainDiscoveryResult> {
  if (!params.enabled) {
    params.log('warning', 'blockchain_discovery', 'Blockchain discovery skipped');
    return { collectionData: null, trades: null, statistics: null, securityCheck: null };
  }

  params.log('info', 'blockchain_discovery', 'Starting blockchain discovery with NFT Scan, Moralis, and GoPlus Security');
  let collectionData: BlockchainDiscoveryResult['collectionData'] = null;
  let trades: BlockchainDiscoveryResult['trades'] = null;
  let statistics: BlockchainDiscoveryResult['statistics'] = null;

  params.log('info', 'blockchain_discovery', 'Fetching NFT Scan collection data');
  try {
    collectionData = await runTimed(params.timingBreakdown, 'NFT Scan Collection',
      () => getNFTCollection({ contractAddress: params.contractAddress, chain: params.chain }));
    if (collectionData) params.log('success', 'blockchain_discovery', `NFT Scan collection found: ${collectionData.name}`);
  } catch (error) {
    params.log('warning', 'blockchain_discovery', `NFT Scan collection failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!collectionData) {
    params.log('info', 'blockchain_discovery', 'NFT Scan failed, trying Moralis');
    try {
      const moralisCollection = await runTimed(params.timingBreakdown, 'Moralis Collection',
        () => getMoralisCollection({ contractAddress: params.contractAddress, chain: params.chain }));
      if (moralisCollection) {
        collectionData = { contractAddress: moralisCollection.tokenAddress, name: moralisCollection.name, symbol: moralisCollection.symbol, contractType: moralisCollection.contractType, ownerCount: 0, totalSupply: 0, totalVolume: '0', floorPrice: '0', floorPriceSymbol: '', logo: '', description: '', website: '', twitter: '', discord: '', telegram: '', isVerified: false };
        params.log('success', 'blockchain_discovery', `Moralis collection found: ${moralisCollection.name}`);
      }
    } catch (error) {
      params.log('warning', 'blockchain_discovery', `Moralis collection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  params.log('info', 'blockchain_discovery', 'Fetching recent trades');
  try {
    trades = await runTimed(params.timingBreakdown, 'NFT Scan Trades',
      () => getNFTTrades({ contractAddress: params.contractAddress, chain: params.chain, limit: 10 }));
    if (!trades) {
      trades = await runTimed(params.timingBreakdown, 'Moralis Trades',
        () => getMoralisTrades({ contractAddress: params.contractAddress, chain: params.chain, limit: 10 }));
    }
    if (trades && trades.length > 0) params.log('success', 'blockchain_discovery', `Found ${trades.length} recent trades`);
  } catch (error) {
    params.log('warning', 'blockchain_discovery', `Trades fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  params.log('info', 'blockchain_discovery', 'Fetching collection statistics');
  try {
    statistics = await runTimed(params.timingBreakdown, 'NFT Scan Statistics',
      () => getNFTStatistics({ contractAddress: params.contractAddress, chain: params.chain }));
    if (statistics) params.log('success', 'blockchain_discovery', `Statistics loaded: ${statistics.totalHolderCount} holders, ${statistics.totalTradeCount} trades`);
  } catch (error) {
    params.log('warning', 'blockchain_discovery', `Statistics fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let securityCheck: BlockchainDiscoveryResult['securityCheck'] = null;
  params.log('info', 'blockchain_discovery', 'Running GoPlus Security check');
  try {
    securityCheck = await runTimed(params.timingBreakdown, 'GoPlus Security',
      () => checkTokenSecurity({ contractAddress: params.contractAddress, chain: params.chain }));
    if (securityCheck) {
      params.log('success', 'blockchain_discovery', `Security check complete: risk score ${securityCheck.riskScore}/100`);
      if (securityCheck.riskFactors.length > 0) params.log('warning', 'blockchain_discovery', `Risk factors: ${securityCheck.riskFactors.join(', ')}`);
    }
  } catch (error) {
    params.log('warning', 'blockchain_discovery', `GoPlus Security check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { collectionData, trades, statistics, securityCheck };
}

// ── Market intelligence with cache ────────────────────────────────────────────

export async function fetchCollectionIntelligenceWithCache(params: {
  intent: MintIntent;
  metadata: CachedCollectionMetadata;
  cacheStats: AnalyzerCacheStats;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}): Promise<AnalyzerCollectionIntelligence> {
  const contract = params.intent.contractAddress ?? params.intent.collectionSlug ?? params.intent.sourceUrl;
  const key = ANALYZER_CACHE_KEYS.marketMetrics(contract, params.intent.chain);
  const cached = await readAnalyzerCache<AnalyzerCollectionIntelligence>(key, params.cacheStats);
  logCacheResult(params.log, Boolean(cached), 'Market Metrics');
  if (cached) return cached;
  const fresh = await fetchCollectionIntelligence({ intent: params.intent, metadata: params.metadata, log: params.log, timingBreakdown: params.timingBreakdown });
  await writeAnalyzerCache(key, fresh, ANALYZER_CACHE_TTL.marketMetrics);
  return fresh;
}

// ── Risk analysis ─────────────────────────────────────────────────────────────

export async function runAnalyzerRisk(params: {
  userId: string;
  contractAddress?: string | null;
  chain?: string | null;
  mintFunction?: string | null;
  mintPrice?: string | null;
  collectionName?: string | null;
  owner?: string | null;
  tokenStandard?: string | null;
  totalSupply?: string | null;
  socials?: AnalyzerSocials;
  collectionIntelligence?: AnalyzerCollectionIntelligence;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}): Promise<AnalyzerRiskAnalysis> {
  params.log('info', 'scoring', 'Running risk engine');
  const risk = await runTimed(params.timingBreakdown, 'Risk Engine', () => analyzeAnalyzerRisk({
    userId: params.userId,
    contractAddress: params.contractAddress,
    chain: params.chain,
    mintFunction: params.mintFunction,
    mintPrice: params.mintPrice,
    collectionName: params.collectionName,
    owner: params.owner,
    tokenStandard: params.tokenStandard,
    totalSupply: params.totalSupply,
    socials: params.socials,
    ownerCount: params.collectionIntelligence?.ownerCount,
    volume: params.collectionIntelligence?.volume,
    floorPrice: params.collectionIntelligence?.floorPrice,
    verifiedStatus: params.collectionIntelligence?.verified,
    discoveredAt: new Date(),
  }));
  params.log('success', 'scoring', 'Contract risk complete');
  params.log('success', 'scoring', 'Wallet risk complete');
  params.log('success', 'scoring', 'Social risk complete');
  params.log('success', 'scoring', `Final risk score: ${risk.riskScore}`);
  return risk;
}

// ── History persistence ───────────────────────────────────────────────────────

type SaveAnalyzerHistoryParams = {
  userId: string;
  input: string;
  result: {
    intent: {
      sourceUrl: string;
      collectionName?: string | null;
      collectionSlug?: string | null;
      contractAddress?: string | null;
      chain: string;
    };
    metadata: { name?: string | null };
    mintState: { status: string };
    riskAnalysis: { riskScore: number; riskLevel: string; riskFactors: string[] };
    collectionIntelligence: {
      floorPrice: string | null;
      floorCurrency: string | null;
      floorSymbol: string | null;
      ownerCount: number | null;
      volume: string | null;
      marketStatus: string | null;
      healthScore: number | null;
    };
    socials: AnalyzerSocials;
    socialHealth: { detectedCount: number };
    providerChain: unknown[];
    providerUsed: string;
    cacheUsed: boolean;
    rpcProviderUsed: string | null;
    timingBreakdown: AnalyzerTiming[];
  };
  scores: ReturnType<typeof deriveAnalyzerScores>;
  analysisDurationMs: number;
};

export async function saveAnalyzerHistorySafely(
  params: SaveAnalyzerHistoryParams,
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void,
) {
  try {
    const [record] = await getDb()
      .insert(analyzerHistory)
      .values({
        userId: params.userId,
        input: params.input,
        sourceUrl: params.result.intent.sourceUrl,
        collectionName: params.result.metadata.name ?? params.result.intent.collectionName ?? params.result.intent.collectionSlug ?? null,
        contractAddress: params.result.intent.contractAddress ?? null,
        chain: params.result.intent.chain,
        riskScore: params.result.riskAnalysis.riskScore,
        riskLevel: params.result.riskAnalysis.riskLevel,
        riskFactors: params.result.riskAnalysis.riskFactors,
        floorPrice: params.result.collectionIntelligence.floorPrice,
        floorCurrency: params.result.collectionIntelligence.floorCurrency,
        floorSymbol: params.result.collectionIntelligence.floorSymbol,
        ownerCount: params.result.collectionIntelligence.ownerCount,
        volume: params.result.collectionIntelligence.volume,
        marketStatus: params.result.collectionIntelligence.marketStatus,
        healthScore: params.result.collectionIntelligence.healthScore,
        opportunityScore: params.scores.opportunity,
        readinessScore: params.scores.readiness,
        mintState: params.result.mintState.status,
        providerUsed: params.result.providerUsed,
        cacheUsed: params.result.cacheUsed,
        rpcProviderUsed: params.result.rpcProviderUsed,
        providerChain: params.result.providerChain,
        timingBreakdown: params.result.timingBreakdown,
        socials: params.result.socials,
        socialCount: params.result.socialHealth.detectedCount,
        analysisDurationMs: params.analysisDurationMs,
      })
      .returning({ id: analyzerHistory.id });
    log('success', 'history', 'Analyzer history saved');
    log('success', 'history', `History record id: ${record.id}`);
    return record.id;
  } catch (error) {
    log('warning', 'history', `Analyzer history save failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
