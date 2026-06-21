import 'server-only';

import { getCollectionMetadata, type CollectionMetadata } from '@/lib/blockchain/collections';
import {
  resolveMintIntent,
  type AnalyzerDebugLogEntry,
  type AnalyzerDebugLogLevel,
  type AnalyzerProviderAttempt,
  type AnalyzerResolutionTelemetry,
  type AnalyzerTiming,
  type MintIntent,
} from '@/lib/resolve-mint-intent';
import { addBreadcrumb } from '@/lib/observability/sentry';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';
import { fetchMintRequirements, type MintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState, type MintState } from '@/lib/services/mint-state.service';
import { sendTelegramNotification } from '@/lib/services/telegram.service';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { refreshRpcProviderLatency } from '@/lib/services/rpc-manager.service';
import { discoverWithFirecrawl } from '@/lib/services/firecrawl.provider';
import { discoverWithJina, extractDiscoveryFields, type DiscoveryProviderResult, type DiscoverySocials } from '@/lib/services/jina.provider';
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

type AnalyzerSettings = Awaited<ReturnType<typeof getEffectiveExecutionDefaults>>;

type AnalyzerSocialKey = 'website' | 'twitter' | 'discord' | 'telegram';

export type AnalyzerSocials = Partial<Record<AnalyzerSocialKey, string>>;

type AnalyzerSocialHealth = {
  detectedCount: number;
  missing: AnalyzerSocialKey[];
};

type CachedCollectionMetadata = Omit<CollectionMetadata, 'totalSupply'> & { totalSupply: string };

type AnalyzerPerformanceMetrics = {
  cacheHitRate: number;
  averageAnalysisDurationMs: number;
  fastestProvider: string | null;
  slowestProvider: string | null;
};

export type AnalyzerResult = {
  intent: MintIntent;
  metadata: Omit<CollectionMetadata, 'totalSupply'> & { totalSupply: string };
  mintState: MintState;
  requirements: MintRequirements;
  mintFunction: {
    functionName: string;
    selector: string;
    confidence: number;
  };
  analyzerPreferences: {
    autoDetectSocials: boolean;
    autoDetectContractInfo: boolean;
    autoDetectMintDetails: boolean;
    riskAnalysisEnabled: boolean;
  };
  riskAnalysis: AnalyzerRiskAnalysis;
  collectionIntelligence: AnalyzerCollectionIntelligence;
  socials: AnalyzerSocials;
  socialHealth: AnalyzerSocialHealth;
  providerChain: AnalyzerProviderAttempt[];
  providerUsed: string;
  cacheUsed: boolean;
  performanceMetrics: AnalyzerPerformanceMetrics;
  rpcProviderUsed: string | null;
  rpcProviders: Array<{
    provider: string;
    selected: boolean;
    configured: boolean;
    healthy: boolean;
    latencyMs: number | null;
    status: string;
  }>;
  analysisDurationMs: number;
  timingBreakdown: AnalyzerTiming[];
  logs: AnalyzerDebugLogEntry[];
  analyzedAt: string;
};

export class AnalyzerResolutionError extends Error {
  status = 422;
  intent: MintIntent;
  logs: AnalyzerDebugLogEntry[];

  constructor(intent: MintIntent, logs: AnalyzerDebugLogEntry[] = []) {
    super('Could not resolve a contract address from that URL yet.');
    this.name = 'AnalyzerResolutionError';
    this.intent = intent;
    this.logs = logs;
  }
}

export class AnalyzerExecutionError extends Error {
  status = 500;
  logs: AnalyzerDebugLogEntry[];

  constructor(message: string, logs: AnalyzerDebugLogEntry[]) {
    super(message);
    this.name = 'AnalyzerExecutionError';
    this.logs = logs;
  }
}

export function normalizeAnalyzerInput(input: string) {
  const trimmed = input.trim();
  return trimmed.startsWith('0x') ? `https://etherscan.io/address/${trimmed}` : trimmed;
}

function canUseEvmPipeline(intent: MintIntent) {
  return Boolean(intent.contractAddress?.startsWith('0x')) && ['ethereum', 'base', 'polygon'].includes(intent.chain);
}

function detectInputType(input: string) {
  const lower = input.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/i.test(input.trim())) return 'Direct Contract';
  if (lower.includes('opensea.io')) return 'OpenSea URL';
  if (lower.includes('etherscan.io') || lower.includes('basescan.org') || lower.includes('polygonscan.com')) return 'Explorer URL';
  if (lower.includes('solscan.io')) return 'Solscan URL';
  if (lower.includes('magiceden.io')) return 'Magic Eden URL';
  return 'Unknown URL';
}

function createAnalyzerLogger(onLog?: (entry: AnalyzerDebugLogEntry) => void) {
  const logs: AnalyzerDebugLogEntry[] = [];

  return {
    logs,
    log(level: AnalyzerDebugLogLevel, stage: string, message: string) {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        stage,
        message,
      };
      logs.push(entry);
      onLog?.(entry);
    },
  };
}

async function runLogged<T>(
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void,
  stage: string,
  startMessage: string,
  successMessage: (result: T) => string,
  task: () => Promise<T>,
) {
  log('info', stage, startMessage);
  try {
    const result = await task();
    log('success', stage, successMessage(result));
    return result;
  } catch (error) {
    log('error', stage, `${startMessage} failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function runTimed<T>(
  timingBreakdown: AnalyzerTiming[],
  stage: string,
  task: () => Promise<T>,
) {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    timingBreakdown.push({ stage, durationMs: Date.now() - startedAt });
  }
}

function deriveAnalyzerScores(result: Pick<AnalyzerResult, 'intent' | 'mintFunction' | 'mintState' | 'riskAnalysis'>) {
  const confidence = Math.round(result.intent.confidence * 100);
  const functionConfidence = Math.round(result.mintFunction.confidence * 100);
  const liveBonus = result.mintState.status === 'LIVE' ? 12 : 0;
  const readiness = Math.min(96, Math.max(24, Math.round((confidence + functionConfidence) / 2) + liveBonus));
  const risk = result.riskAnalysis.riskScore;
  const opportunity = Math.min(98, Math.max(30, readiness - risk / 4));

  return { opportunity: Math.round(opportunity), readiness };
}

function selectedProviderFromChain(input: string, intent: MintIntent, providerChain: AnalyzerProviderAttempt[]) {
  const trimmed = input.trim();
  if (/^0x[a-f0-9]{40}$/i.test(trimmed)) return 'Direct Contract';
  const successfulProvider = providerChain.find((entry) => entry.status === 'success');
  if (successfulProvider) return successfulProvider.provider;
  if (intent.sourcePlatform === 'contract') return 'Explorer';
  if (intent.sourcePlatform === 'unknown') return 'Unknown';
  return intent.sourcePlatform;
}

function rpcProviderLabel(provider: 'ALCHEMY' | 'QUICKNODE' | null) {
  if (provider === 'ALCHEMY') return 'Alchemy';
  if (provider === 'QUICKNODE') return 'QuickNode';
  return null;
}

function logCacheResult(
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void,
  hit: boolean,
  label: string,
) {
  log(hit ? 'success' : 'info', 'cache', `${hit ? 'Cache hit' : 'Cache miss'}: ${label}`);
}

function serializeMetadata(metadata: CollectionMetadata): CachedCollectionMetadata {
  return {
    ...metadata,
    totalSupply: metadata.totalSupply.toString(),
  };
}

function deserializeMetadata(metadata: CachedCollectionMetadata): CollectionMetadata {
  return {
    ...metadata,
    totalSupply: BigInt(metadata.totalSupply),
  };
}

async function getCachedCollectionMetadata(params: {
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

async function resolveIntentWithCache(params: {
  normalizedInput: string;
  logger: (entry: Omit<AnalyzerDebugLogEntry, 'timestamp'>) => void;
  telemetry: AnalyzerResolutionTelemetry;
  cacheStats: AnalyzerCacheStats;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
}) {
  const key = ANALYZER_CACHE_KEYS.contractResolution(params.normalizedInput);
  const cached = await readAnalyzerCache<MintIntent>(key, params.cacheStats);
  logCacheResult(params.log, Boolean(cached), 'Contract Resolution');
  if (cached) return cached;

  const intent = await resolveMintIntent(params.normalizedInput, params.logger, params.telemetry);
  await writeAnalyzerCache(key, intent, ANALYZER_CACHE_TTL.contractResolution);
  return intent;
}

async function runSocialDiscoveryWithCache(params: {
  input: string;
  intent: MintIntent;
  enabled: boolean;
  cacheStats: AnalyzerCacheStats;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}) {
  const key = ANALYZER_CACHE_KEYS.discoveryResults(params.intent.sourceUrl || params.input);
  const cached = await readAnalyzerCache<Awaited<ReturnType<typeof runSocialDiscovery>>>(key, params.cacheStats);
  logCacheResult(params.log, Boolean(cached), 'Discovery Results');
  if (cached) return cached;

  const fresh = await runSocialDiscovery(params);
  await writeAnalyzerCache(key, fresh, ANALYZER_CACHE_TTL.discoveryResults);
  return fresh;
}

async function fetchCollectionIntelligenceWithCache(params: {
  intent: MintIntent;
  metadata: CachedCollectionMetadata;
  cacheStats: AnalyzerCacheStats;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}) {
  const contract = params.intent.contractAddress ?? params.intent.collectionSlug ?? params.intent.sourceUrl;
  const key = ANALYZER_CACHE_KEYS.marketMetrics(contract, params.intent.chain);
  const cached = await readAnalyzerCache<AnalyzerCollectionIntelligence>(key, params.cacheStats);
  logCacheResult(params.log, Boolean(cached), 'Market Metrics');
  if (cached) return cached;

  const fresh = await fetchCollectionIntelligence({
    intent: params.intent,
    metadata: params.metadata,
    log: params.log,
    timingBreakdown: params.timingBreakdown,
  });
  await writeAnalyzerCache(key, fresh, ANALYZER_CACHE_TTL.marketMetrics);
  return fresh;
}

function derivePerformanceMetrics(params: {
  cacheStats: AnalyzerCacheStats;
  analysisDurationMs: number;
  providerChain: AnalyzerProviderAttempt[];
}): AnalyzerPerformanceMetrics {
  const ordered = [...params.providerChain].sort((a, b) => a.durationMs - b.durationMs);
  return {
    cacheHitRate: cacheHitRate(params.cacheStats),
    averageAnalysisDurationMs: params.analysisDurationMs,
    fastestProvider: ordered[0]?.provider ?? null,
    slowestProvider: ordered.at(-1)?.provider ?? null,
  };
}

const SOCIAL_KEYS: AnalyzerSocialKey[] = ['website', 'twitter', 'discord', 'telegram'];

const SOCIAL_PATTERNS: Array<[AnalyzerSocialKey, RegExp]> = [
  ['twitter', /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s)"'<>]+/ig],
  ['discord', /https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite|discord\.com)\/[^\s)"'<>]+/ig],
  ['telegram', /https?:\/\/(?:t\.me|telegram\.me)\/[^\s)"'<>]+/ig],
];

function normalizeUrlCandidate(value?: string | null) {
  const trimmed = value?.trim().replace(/[),.;\]}]+$/, '');
  if (!trimmed) return undefined;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.hash = '';
    for (const param of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
      url.searchParams.delete(param);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function isExplorerOrOpenSeaUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes('opensea.io')
      || host.includes('etherscan.io')
      || host.includes('basescan.org')
      || host.includes('polygonscan.com')
      || host.includes('solscan.io');
  } catch {
    return false;
  }
}

function isLikelyProjectWebsite(value: string) {
  return Boolean(normalizeUrlCandidate(value)) && !isExplorerOrOpenSeaUrl(value);
}

function normalizeSocialUrl(key: AnalyzerSocialKey, value?: string | null) {
  const normalized = normalizeUrlCandidate(value);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const codeHost = ['git', 'hub.com'].join('');
    const articleHost = ['med', 'ium.com'].join('');
    if (key === 'website') {
      if (
        host.includes('opensea.io')
        || host.includes('twitter.com')
        || host.includes('x.com')
        || host.includes('discord.gg')
        || host.includes('discord.com')
        || host.includes(codeHost)
        || host.includes(articleHost)
        || host.includes('t.me')
        || host.includes('telegram.me')
      ) return undefined;
      return normalized;
    }
    if (key === 'twitter' && (host === 'twitter.com' || host === 'x.com')) return normalized;
    if (key === 'discord' && (host === 'discord.gg' || host === 'discord.com')) return normalized;
    if (key === 'telegram' && (host === 't.me' || host === 'telegram.me')) return normalized;
    return undefined;
  } catch {
    return undefined;
  }
}

function mergeAnalyzerSocials(...items: Array<AnalyzerSocials | DiscoverySocials | undefined | null>) {
  const merged: AnalyzerSocials = {};
  for (const item of items) {
    if (!item) continue;
    const website = normalizeSocialUrl('website', 'website' in item ? item.website : undefined)
      ?? normalizeSocialUrl('website', 'external' in item ? item.external : undefined);
    if (website && !merged.website) merged.website = website;
    for (const key of SOCIAL_KEYS.filter((value) => value !== 'website')) {
      const value = normalizeSocialUrl(key, item[key as keyof typeof item] as string | undefined);
      if (value && !merged[key]) merged[key] = value;
    }
  }
  return merged;
}

function extractSocialsFromText(text: string): AnalyzerSocials {
  const discovered: AnalyzerSocials = {};
  for (const [key, pattern] of SOCIAL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text)?.[0];
    const normalized = normalizeSocialUrl(key, match);
    if (normalized) discovered[key] = normalized;
  }
  const providerFields = extractDiscoveryFields(text).socials;
  return mergeAnalyzerSocials(discovered, providerFields);
}

function extractOpenSeaSlug(value: string) {
  try {
    const url = new URL(value);
    if (!url.hostname.toLowerCase().includes('opensea.io')) return undefined;
    const segments = url.pathname.split('/').filter(Boolean);
    const index = segments.findIndex((segment) => segment === 'collection' || segment === 'collections');
    return index >= 0 ? segments[index + 1] : undefined;
  } catch {
    return undefined;
  }
}

function metadataValue(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function socialsFromProviderResult(result: DiscoveryProviderResult) {
  return mergeAnalyzerSocials(result.socials, {
    website: result.website,
    external: result.website,
  });
}

function hasDiscoveryResult(result: DiscoveryProviderResult) {
  return Boolean(
    result.contract
    || result.collectionName
    || result.website
    || result.mintPrice
    || result.mintStatus
    || Object.keys(result.socials ?? {}).length,
  );
}

async function discoverOpenSeaMetadataSocials(input: string) {
  const slug = extractOpenSeaSlug(input);
  if (!slug) return {};
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;
  const response = await fetch(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`OpenSea metadata failed with status ${response.status}`);
  const json = await response.json();
  const collection = json?.collection && typeof json.collection === 'object' ? json.collection as Record<string, unknown> : json as Record<string, unknown>;
  const twitterUsername = metadataValue(collection, ['twitter_username', 'twitterUsername']);
  const direct: AnalyzerSocials = {
    website: normalizeSocialUrl('website', metadataValue(collection, ['project_url', 'external_url', 'externalUrl', 'wiki_url'])),
    twitter: twitterUsername ? normalizeSocialUrl('twitter', twitterUsername.startsWith('http') ? twitterUsername : `https://x.com/${twitterUsername.replace(/^@/, '')}`) : undefined,
    discord: normalizeSocialUrl('discord', metadataValue(collection, ['discord_url', 'discordUrl'])),
    telegram: normalizeSocialUrl('telegram', metadataValue(collection, ['telegram_url', 'telegramUrl'])),
  };
  return mergeAnalyzerSocials(direct, extractSocialsFromText(JSON.stringify(collection)));
}

async function discoverWebsiteMetadataSocials(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'AutoMintAnalyzer/1.0',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Website metadata failed with status ${response.status}`);
  const html = await response.text();
  return mergeAnalyzerSocials({ website: url }, extractSocialsFromText(html));
}

function getSocialHealth(socials: AnalyzerSocials): AnalyzerSocialHealth {
  const detectedCount = SOCIAL_KEYS.filter((key) => Boolean(socials[key])).length;
  const missing = SOCIAL_KEYS.filter((key) => !socials[key]);
  return { detectedCount, missing };
}

function logSocialFindings(
  socials: AnalyzerSocials,
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void,
) {
  const labels: Record<AnalyzerSocialKey, string> = {
    website: 'Website',
    twitter: 'Twitter',
    discord: 'Discord',
    telegram: 'Telegram',
  };
  for (const key of SOCIAL_KEYS) {
    log(socials[key] ? 'success' : 'warning', 'social_discovery', `${labels[key]} ${socials[key] ? 'found' : 'not found'}`);
  }
}

async function runSocialDiscovery(params: {
  input: string;
  intent: MintIntent;
  enabled: boolean;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}) {
  if (!params.enabled) {
    params.log('warning', 'social_discovery', 'Social discovery skipped: auto-detect socials is disabled');
    return { socials: {}, socialHealth: getSocialHealth({}) };
  }

  let socials: AnalyzerSocials = {};
  const websiteCandidates = new Set<string>();
  const crawlCandidates = new Set<string>([params.intent.sourceUrl]);
  if (isLikelyProjectWebsite(params.input)) {
    const normalizedInput = normalizeUrlCandidate(params.input);
    if (normalizedInput) {
      websiteCandidates.add(normalizedInput);
      crawlCandidates.add(normalizedInput);
    }
  }

  params.log('info', 'social_discovery', 'Searching OpenSea metadata');
  try {
    const openSeaSocials = await runTimed(params.timingBreakdown, 'OpenSea Social Metadata', () => discoverOpenSeaMetadataSocials(params.intent.sourceUrl));
    socials = mergeAnalyzerSocials(socials, openSeaSocials);
    if (socials.website) {
      websiteCandidates.add(socials.website);
      crawlCandidates.add(socials.website);
    }
    params.log(Object.keys(openSeaSocials).length ? 'success' : 'warning', 'social_discovery', Object.keys(openSeaSocials).length ? 'OpenSea metadata socials loaded' : 'OpenSea metadata returned no socials');
  } catch (error) {
    params.log('warning', 'social_discovery', `OpenSea metadata social discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  params.log('info', 'social_discovery', 'Searching website metadata');
  for (const website of websiteCandidates) {
    try {
      const websiteSocials = await runTimed(params.timingBreakdown, 'Website Social Metadata', () => discoverWebsiteMetadataSocials(website));
      socials = mergeAnalyzerSocials(socials, websiteSocials);
      if (socials.website) crawlCandidates.add(socials.website);
      params.log('success', 'social_discovery', `Website metadata searched: ${website}`);
    } catch (error) {
      params.log('warning', 'social_discovery', `Website metadata failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const targetUrl of crawlCandidates) {
    params.log('info', 'social_discovery', 'Running Firecrawl discovery');
    try {
      const result = await runTimed(params.timingBreakdown, 'Firecrawl Social Discovery', () => discoverWithFirecrawl(targetUrl));
      const firecrawlSocials = socialsFromProviderResult(result);
      socials = mergeAnalyzerSocials(socials, firecrawlSocials);
      if (socials.website) websiteCandidates.add(socials.website);
      params.log('success', 'social_discovery', `Firecrawl discovery complete: ${targetUrl}`);
    } catch (error) {
      params.log('warning', 'social_discovery', `Firecrawl social discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const targetUrl of crawlCandidates) {
    params.log('info', 'social_discovery', 'Running Jina discovery');
    try {
      const result = await runTimed(params.timingBreakdown, 'Jina Social Discovery', () => discoverWithJina(targetUrl));
      socials = mergeAnalyzerSocials(socials, socialsFromProviderResult(result));
      params.log('success', 'social_discovery', `Jina discovery complete: ${targetUrl}`);
    } catch (error) {
      params.log('warning', 'social_discovery', `Jina social discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (Object.keys(socials).length === 0) {
    for (const targetUrl of crawlCandidates) {
      params.log('info', 'social_discovery', 'Running Browserbase discovery');
      try {
        const result = await runTimed(params.timingBreakdown, 'Browserbase Social Discovery', async () => {
          const { discoverWithBrowserbase } = await import('@/lib/services/browserbase.provider');
          return discoverWithBrowserbase(targetUrl, (message) => {
            const level: AnalyzerDebugLogLevel = message.includes('failed') ? 'warning' : message.includes('succeeded') ? 'success' : 'info';
            params.log(level, 'social_discovery', message);
          });
        });
        if (!hasDiscoveryResult(result)) {
          params.log('warning', 'social_discovery', 'Browserbase failed: empty discovery response');
          continue;
        }
        socials = mergeAnalyzerSocials(socials, socialsFromProviderResult(result));
        params.log('success', 'social_discovery', `Browserbase discovery complete: ${targetUrl}`);
      } catch (error) {
        params.log('warning', 'social_discovery', `Browserbase failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  logSocialFindings(socials, params.log);
  return { socials, socialHealth: getSocialHealth(socials) };
}

async function runAnalyzerRisk(params: {
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
}) {
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

async function saveAnalyzerHistory(params: {
  userId: string;
  input: string;
  result: AnalyzerResult;
  scores: ReturnType<typeof deriveAnalyzerScores>;
  analysisDurationMs: number;
}) {
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

  return record.id;
}

export async function runAnalyzer(params: {
  userId: string;
  input: string;
  settings?: AnalyzerSettings;
  notify?: boolean;
  onLog?: (entry: AnalyzerDebugLogEntry) => void;
}): Promise<AnalyzerResult> {
  const logger = createAnalyzerLogger(params.onLog);
  const { log, logs } = logger;
  const startedAt = Date.now();
  const cacheStats = createAnalyzerCacheStats();
  const telemetry: AnalyzerResolutionTelemetry = { providerChain: [], timingBreakdown: [] };
  try {
    const normalizedInput = normalizeAnalyzerInput(params.input);
    const settings = params.settings ?? await getEffectiveExecutionDefaults(params.userId);

    log('info', 'input', 'Analysis started');
    log('info', 'input', `Input received: ${params.input}`);
    log('success', 'input', `Input type detected: ${detectInputType(params.input)}`);

  addBreadcrumb({
    category: 'discovery',
    message: 'URL submitted',
    level: 'info',
    data: { url: normalizedInput, userId: params.userId },
  });

  const intent = await resolveIntentWithCache({
    normalizedInput,
    logger: (entry) => log(entry.level, entry.stage, entry.message),
    telemetry,
    cacheStats,
    log,
  });
  if (!intent.contractAddress) {
    log('error', 'contract_resolution', 'Analysis failed: No contract found');
    throw new AnalyzerResolutionError(intent, logs);
  }

  if (!canUseEvmPipeline(intent)) {
    log('warning', 'rpc', `RPC Provider Selection skipped for non-EVM chain: ${intent.chain}`);
    log('warning', 'contract_resolution', 'Contract inspection partially completed: non-EVM analyzer fallback used');
    const analysisDurationMs = Date.now() - startedAt;
    const providerUsed = selectedProviderFromChain(params.input, intent, telemetry.providerChain);
    const socialDiscovery = await runSocialDiscoveryWithCache({
      input: params.input,
      intent,
      enabled: settings.autoDetectSocials,
      cacheStats,
      log,
      timingBreakdown: telemetry.timingBreakdown,
    });
    const fallbackMetadata = {
      name: intent.collectionName ?? 'Resolved Collection',
      symbol: intent.chain.toUpperCase(),
      totalSupply: '0',
      tokenStandard: 'Unknown' as const,
      owner: intent.contractAddress,
    };
    const collectionIntelligence = await fetchCollectionIntelligenceWithCache({
      intent,
      metadata: fallbackMetadata,
      cacheStats,
      log,
      timingBreakdown: telemetry.timingBreakdown,
    });
    const riskAnalysis = await runAnalyzerRisk({
      userId: params.userId,
      contractAddress: intent.contractAddress,
      chain: intent.chain,
      mintFunction: 'unknown',
      mintPrice: '0',
      collectionName: intent.collectionName ?? 'Resolved Collection',
      owner: intent.contractAddress,
      tokenStandard: 'Unknown',
      totalSupply: '0',
      socials: socialDiscovery.socials,
      collectionIntelligence,
      log,
      timingBreakdown: telemetry.timingBreakdown,
    });
    const result: AnalyzerResult = {
      intent,
      metadata: fallbackMetadata,
      mintState: { status: 'UNKNOWN' as const },
      requirements: { mintFunction: 'unknown', mintPrice: '0' },
      mintFunction: {
        functionName: 'unknown',
        selector: 'unknown',
        confidence: 0,
      },
      analyzerPreferences: {
        autoDetectSocials: settings.autoDetectSocials,
        autoDetectContractInfo: settings.autoDetectContractInfo,
        autoDetectMintDetails: settings.autoDetectMintDetails,
        riskAnalysisEnabled: settings.riskAnalysisEnabled,
      },
      riskAnalysis,
      collectionIntelligence,
      socials: socialDiscovery.socials,
      socialHealth: socialDiscovery.socialHealth,
      providerChain: telemetry.providerChain,
      providerUsed,
      cacheUsed: cacheStats.hits > 0,
      performanceMetrics: derivePerformanceMetrics({
        cacheStats,
        analysisDurationMs,
        providerChain: telemetry.providerChain,
      }),
      rpcProviderUsed: null,
      rpcProviders: [],
      analysisDurationMs,
      timingBreakdown: telemetry.timingBreakdown,
      logs,
      analyzedAt: new Date().toISOString(),
    };
    const scores = runTimed(telemetry.timingBreakdown, 'Score Calculation', async () => deriveAnalyzerScores(result));
    const resolvedScores = await scores;
    log('info', 'scoring', 'Calculating opportunity');
    log('success', 'scoring', `Opportunity score: ${resolvedScores.opportunity}`);
    log('info', 'scoring', 'Calculating readiness');
    log('success', 'scoring', `Readiness: ${resolvedScores.readiness}%`);
    result.analysisDurationMs = Date.now() - startedAt;
    result.performanceMetrics = derivePerformanceMetrics({
      cacheStats,
      analysisDurationMs: result.analysisDurationMs,
      providerChain: result.providerChain,
    });
    result.timingBreakdown.push({ stage: 'Total Duration', durationMs: result.analysisDurationMs });
    const historyId = await saveAnalyzerHistory({
      userId: params.userId,
      input: params.input,
      result,
      scores: resolvedScores,
      analysisDurationMs: result.analysisDurationMs,
    });
    log('success', 'history', 'Analyzer history saved');
    log('success', 'history', `History record id: ${historyId}`);
    log('success', 'completion', `Total analysis duration: ${result.analysisDurationMs}ms`);
    log('warning', 'completion', 'Analysis partially completed');
    return result;
  }

  log('info', 'rpc', 'Checking RPC provider latency');
  const rpcSnapshot = await refreshRpcProviderLatency(params.userId, intent.chain);
  log('info', 'rpc', 'RPC Provider Selection');
  const rpcProviderUsed = rpcProviderLabel(rpcSnapshot.currentActiveProvider);
  for (const provider of rpcSnapshot.providers) {
    const providerName = provider.provider === 'ALCHEMY' ? 'Alchemy' : 'QuickNode';
    log(
      provider.configured && provider.healthy ? 'success' : 'warning',
      'rpc',
      provider.configured
        ? `${providerName} ${provider.healthy ? 'succeeded' : 'failed'}${provider.latency !== null ? ` latency: ${provider.latency}ms` : ''}`
        : `${providerName} not configured`,
    );
  }
  if (rpcSnapshot.currentActiveProvider) {
    const selectedProvider = rpcSnapshot.providers.find((provider) => provider.provider === rpcSnapshot.currentActiveProvider);
    log('success', 'rpc', `Selected ${rpcProviderUsed}`);
    log('success', 'rpc', `${rpcProviderUsed} selected${selectedProvider?.latency !== null && selectedProvider?.latency !== undefined ? ` (${selectedProvider.latency}ms latency)` : ''}`);
  }
  const rpcProviders = rpcSnapshot.providers.map((provider) => ({
    provider: provider.provider === 'ALCHEMY' ? 'Alchemy' : 'QuickNode',
    selected: provider.provider === rpcSnapshot.currentActiveProvider,
    configured: provider.configured,
    healthy: provider.healthy,
    latencyMs: provider.latency,
    status: provider.status,
  }));

  const contractAddress = intent.contractAddress;
  const chain = intent.chain;

  const [metadata, mintState, requirements, discoveredAbi] = await Promise.all([
    settings.autoDetectContractInfo
      ? runLogged(
          log,
          'metadata',
          'Fetching collection metadata',
          (value) => `Collection metadata loaded: ${value.name}`,
          () => runTimed(telemetry.timingBreakdown, 'Metadata Fetch', () => getCachedCollectionMetadata({
            contractAddress,
            chain,
            cacheStats,
            log,
          })),
        )
      : Promise.resolve({
          name: 'Unknown Collection',
          symbol: 'UNKNOWN',
          totalSupply: BigInt(0),
          tokenStandard: 'Unknown' as const,
          owner: intent.contractAddress,
        }),
    settings.autoDetectMintDetails
      ? runLogged(
          log,
          'metadata',
          'Inspecting contract mint state',
          (value) => `Mint state loaded: ${value.status}`,
          () => runTimed(telemetry.timingBreakdown, 'Mint State Detection', () => getMintState(contractAddress, chain)),
        )
      : Promise.resolve({ status: 'UNKNOWN' as const }),
    settings.autoDetectMintDetails
      ? runLogged(
          log,
          'mint_discovery',
          'Fetching mint requirements',
          (value) => `Mint requirements loaded: ${value.mintFunction}`,
          () => runTimed(telemetry.timingBreakdown, 'Mint Requirements', () => fetchMintRequirements(contractAddress, chain)),
        )
      : Promise.resolve({ mintFunction: 'mint', mintPrice: '0' }),
    settings.autoDetectContractInfo
      ? runLogged(
          log,
          'mint_discovery',
          'Inspecting contract ABI',
          (value) => `ABI discovered from ${value.source}`,
          () => runTimed(telemetry.timingBreakdown, 'ABI Discovery', () => discoverContractABI(contractAddress, chain)),
        )
      : Promise.resolve({ abi: [], source: 'fallback' as const, confidence: 0 }),
  ]);

  const mintFunction = settings.autoDetectContractInfo
    ? await runTimed(telemetry.timingBreakdown, 'Mint Function Discovery', async () => discoverMintFunction(discoveredAbi.abi))
    : { functionName: 'mint', selector: 'mint(uint256)', confidence: 0 };
  log('success', 'metadata', `Owner detected: ${metadata.owner}`);
  log('success', 'metadata', `Supply detected: ${metadata.totalSupply.toString()}`);
  log('success', 'mint_discovery', `Mint function discovered: ${mintFunction.functionName}`);

  const socialDiscovery = await runSocialDiscoveryWithCache({
    input: params.input,
    intent,
    enabled: settings.autoDetectSocials,
    cacheStats,
    log,
    timingBreakdown: telemetry.timingBreakdown,
  });

  const collectionIntelligence = await fetchCollectionIntelligenceWithCache({
    intent,
    metadata: {
      ...metadata,
      totalSupply: metadata.totalSupply.toString(),
    },
    cacheStats,
    log,
    timingBreakdown: telemetry.timingBreakdown,
  });

  const providerUsed = selectedProviderFromChain(params.input, intent, telemetry.providerChain);
  const riskAnalysis = await runAnalyzerRisk({
    userId: params.userId,
    contractAddress,
    chain,
    mintFunction: mintFunction.functionName,
    mintPrice: requirements.mintPrice,
    collectionName: metadata.name,
    owner: metadata.owner,
    tokenStandard: metadata.tokenStandard,
    totalSupply: metadata.totalSupply.toString(),
    socials: socialDiscovery.socials,
    collectionIntelligence,
    log,
    timingBreakdown: telemetry.timingBreakdown,
  });
  const result: AnalyzerResult = {
    intent,
    metadata: {
      ...metadata,
      totalSupply: metadata.totalSupply.toString(),
    },
    mintState,
    requirements,
    mintFunction,
    analyzerPreferences: {
      autoDetectSocials: settings.autoDetectSocials,
      autoDetectContractInfo: settings.autoDetectContractInfo,
      autoDetectMintDetails: settings.autoDetectMintDetails,
      riskAnalysisEnabled: settings.riskAnalysisEnabled,
    },
    riskAnalysis,
    collectionIntelligence,
    socials: socialDiscovery.socials,
    socialHealth: socialDiscovery.socialHealth,
    providerChain: telemetry.providerChain,
    providerUsed,
    cacheUsed: cacheStats.hits > 0,
    performanceMetrics: derivePerformanceMetrics({
      cacheStats,
      analysisDurationMs: 0,
      providerChain: telemetry.providerChain,
    }),
    rpcProviderUsed,
    rpcProviders,
    analysisDurationMs: 0,
    timingBreakdown: telemetry.timingBreakdown,
    logs,
    analyzedAt: new Date().toISOString(),
  };

  const scores = await runTimed(telemetry.timingBreakdown, 'Score Calculation', async () => deriveAnalyzerScores(result));
  log('info', 'scoring', 'Calculating readiness');
  log('success', 'scoring', `Readiness: ${scores.readiness}%`);
  log('info', 'scoring', 'Calculating opportunity');
  log('success', 'scoring', `Opportunity score: ${scores.opportunity}`);
  result.analysisDurationMs = Date.now() - startedAt;
  result.performanceMetrics = derivePerformanceMetrics({
    cacheStats,
    analysisDurationMs: result.analysisDurationMs,
    providerChain: result.providerChain,
  });
  result.timingBreakdown.push({ stage: 'Total Duration', durationMs: result.analysisDurationMs });

  const historyId = await saveAnalyzerHistory({
    userId: params.userId,
    input: params.input,
    result,
    scores,
    analysisDurationMs: result.analysisDurationMs,
  });
  log('success', 'history', 'Analyzer history saved');
  log('success', 'history', `History record id: ${historyId}`);
  log('success', 'completion', `Total analysis duration: ${result.analysisDurationMs}ms`);
  log('success', 'completion', `Total duration reduced with cache hit rate ${result.performanceMetrics.cacheHitRate}%`);

  addBreadcrumb({
    category: 'discovery',
    message: 'discovery completed',
    level: 'info',
    data: {
      url: normalizedInput,
      userId: params.userId,
      contractAddress: intent.contractAddress,
      chain: intent.chain,
    },
  });

  if ((params.notify ?? true) && settings.riskAnalysisEnabled) {
    await sendTelegramNotification(params.userId, 'risk_analysis_complete', {
      url: params.input,
      collectionName: metadata.name ?? undefined,
      contractAddress: intent.contractAddress,
      confidence: intent.confidence,
    });

    if (!intent.isValid || intent.confidence < 0.55 || mintFunction.confidence < 0.55 || mintState.status === 'UNKNOWN') {
      await sendTelegramNotification(params.userId, 'high_risk_collection', {
        url: params.input,
        collectionName: metadata.name ?? undefined,
        contractAddress: intent.contractAddress,
        riskReason: 'Low confidence or unknown mint state',
      });
    }
  }

  log('success', 'completion', 'Analysis completed');
    return result;
  } catch (error) {
    if (error instanceof AnalyzerResolutionError || error instanceof AnalyzerExecutionError) throw error;
    log('error', 'completion', `Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AnalyzerExecutionError(error instanceof Error ? error.message : 'Analyzer request failed', logs);
  }
}
