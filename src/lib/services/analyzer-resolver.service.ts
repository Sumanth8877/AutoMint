import 'server-only';

// ── analyzer-resolver.service.ts ─────────────────────────────────────────────
// Handles URL normalisation, intent resolution, and social-link discovery.
// Called by the thin orchestrator in analyzer.service.ts.
// ─────────────────────────────────────────────────────────────────────────────

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
import { discoverWithFirecrawl } from '@/lib/services/firecrawl.provider';
import { discoverWithJina, extractDiscoveryFields, type DiscoveryProviderResult, type DiscoverySocials } from '@/lib/services/jina.provider';
import {
  ANALYZER_CACHE_KEYS,
  ANALYZER_CACHE_TTL,
  readAnalyzerCache,
  writeAnalyzerCache,
  type AnalyzerCacheStats,
} from '@/lib/services/analyzer-cache.service';

// ── Re-exports consumed by orchestrator ──────────────────────────────────────
export type { AnalyzerDebugLogEntry, AnalyzerDebugLogLevel, AnalyzerTiming };

export type AnalyzerSocialKey = 'website' | 'twitter' | 'discord' | 'telegram';
export type AnalyzerSocials = Partial<Record<AnalyzerSocialKey, string>>;

type AnalyzerSocialHealth = {
  detectedCount: number;
  missing: AnalyzerSocialKey[];
};

export type ResolverResult = {
  socials: AnalyzerSocials;
  socialHealth: AnalyzerSocialHealth;
};

// ── Utilities ─────────────────────────────────────────────────────────────────

export function normalizeAnalyzerInput(input: string) {
  const trimmed = input.trim();
  return trimmed.startsWith('0x') ? `https://etherscan.io/address/${trimmed}` : trimmed;
}

export function detectInputType(input: string) {
  const lower = input.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/i.test(input.trim())) return 'Direct Contract';
  if (lower.includes('opensea.io')) return 'OpenSea URL';
  if (lower.includes('etherscan.io') || lower.includes('basescan.org') || lower.includes('polygonscan.com')) return 'Explorer URL';
  if (lower.includes('solscan.io')) return 'Solscan URL';
  if (lower.includes('magiceden.io')) return 'Magic Eden URL';
  return 'Unknown URL';
}

export function canUseEvmPipeline(intent: MintIntent) {
  return Boolean(intent.contractAddress?.startsWith('0x')) && ['ethereum', 'base', 'polygon'].includes(intent.chain);
}

export function createAnalyzerLogger(onLog?: (entry: AnalyzerDebugLogEntry) => void) {
  const logs: AnalyzerDebugLogEntry[] = [];
  return {
    logs,
    log(level: AnalyzerDebugLogLevel, stage: string, message: string) {
      const entry = { timestamp: new Date().toISOString(), level, stage, message };
      logs.push(entry);
      onLog?.(entry);
    },
  };
}

export async function runLogged<T>(
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

export async function runTimed<T>(
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

// ── Social helpers ────────────────────────────────────────────────────────────

const SOCIAL_KEYS: AnalyzerSocialKey[] = ['website', 'twitter', 'discord', 'telegram'];

const SOCIAL_PATTERNS: Array<[AnalyzerSocialKey, RegExp]> = [
  ['twitter', /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s)"'<>]+/ig],
  ['discord', /https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite|discord\.com)\/[^\s)"'<>]+/ig],
  ['telegram', /https?:\/\/(?:t\.me|telegram\.me)\/[^\s)"'<>]+/ig],
];

function normalizeUrlCandidate(value?: string | null) {
  const trimmed = value?.trim().replace(/[),.\;\]}]+$/, '');
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
    return host.includes('opensea.io') || host.includes('etherscan.io')
      || host.includes('basescan.org') || host.includes('polygonscan.com') || host.includes('solscan.io');
  } catch { return false; }
}

export function isLikelyProjectWebsite(value: string) {
  return Boolean(normalizeUrlCandidate(value)) && !isExplorerOrOpenSeaUrl(value);
}

export function normalizeSocialUrl(key: AnalyzerSocialKey, value?: string | null) {
  const normalized = normalizeUrlCandidate(value);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const codeHost = ['git', 'hub.com'].join('');
    const articleHost = ['med', 'ium.com'].join('');
    if (key === 'website') {
      if (host.includes('opensea.io') || host.includes('twitter.com') || host.includes('x.com')
        || host.includes('discord.gg') || host.includes('discord.com') || host.includes(codeHost)
        || host.includes(articleHost) || host.includes('t.me') || host.includes('telegram.me')) return undefined;
      return normalized;
    }
    if (key === 'twitter' && (host === 'twitter.com' || host === 'x.com')) return normalized;
    if (key === 'discord' && (host === 'discord.gg' || host === 'discord.com')) return normalized;
    if (key === 'telegram' && (host === 't.me' || host === 'telegram.me')) return normalized;
    return undefined;
  } catch { return undefined; }
}

export function mergeAnalyzerSocials(...items: Array<AnalyzerSocials | DiscoverySocials | undefined | null>) {
  const merged: AnalyzerSocials = {};
  for (const item of items) {
    if (!item) continue;
    const website = normalizeSocialUrl('website', 'website' in item ? item.website : undefined)
      ?? normalizeSocialUrl('website', 'external' in item ? (item as { external?: string }).external : undefined);
    if (website && !merged.website) merged.website = website;
    for (const key of SOCIAL_KEYS.filter((v) => v !== 'website')) {
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
    const index = segments.findIndex((s) => s === 'collection' || s === 'collections');
    return index >= 0 ? segments[index + 1] : undefined;
  } catch { return undefined; }
}

function metadataValue(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export function socialsFromProviderResult(result: DiscoveryProviderResult) {
  return mergeAnalyzerSocials(result.socials, { website: result.website, external: result.website });
}

export function hasDiscoveryResult(result: DiscoveryProviderResult) {
  return Boolean(result.contract || result.collectionName || result.website || result.mintPrice
    || result.mintStatus || Object.keys(result.socials ?? {}).length);
}

export function getSocialHealth(socials: AnalyzerSocials): AnalyzerSocialHealth {
  return {
    detectedCount: SOCIAL_KEYS.filter((key) => Boolean(socials[key])).length,
    missing: SOCIAL_KEYS.filter((key) => !socials[key]),
  };
}

function logSocialFindings(
  socials: AnalyzerSocials,
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void,
) {
  const labels: Record<AnalyzerSocialKey, string> = { website: 'Website', twitter: 'Twitter', discord: 'Discord', telegram: 'Telegram' };
  for (const key of SOCIAL_KEYS) {
    log(socials[key] ? 'success' : 'warning', 'social_discovery', `${labels[key]} ${socials[key] ? 'found' : 'not found'}`);
  }
}

async function discoverOpenSeaMetadataSocials(input: string) {
  const slug = extractOpenSeaSlug(input);
  if (!slug) return {};
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.OPENSEA_API_KEY) headers['X-API-KEY'] = process.env.OPENSEA_API_KEY;
  const response = await fetch(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`,
    { headers, signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error(`OpenSea metadata failed with status ${response.status}`);
  const json = await response.json();
  const collection = json?.collection && typeof json.collection === 'object'
    ? json.collection as Record<string, unknown> : json as Record<string, unknown>;
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
    headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'AutoMintAnalyzer/1.0' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Website metadata failed with status ${response.status}`);
  const html = await response.text();
  return mergeAnalyzerSocials({ website: url }, extractSocialsFromText(html));
}

// ── Intent resolution with cache ──────────────────────────────────────────────

export async function resolveIntentWithCache(params: {
  normalizedInput: string;
  logger: (entry: Omit<AnalyzerDebugLogEntry, 'timestamp'>) => void;
  telemetry: AnalyzerResolutionTelemetry;
  cacheStats: AnalyzerCacheStats;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
}) {
  const key = ANALYZER_CACHE_KEYS.contractResolution(params.normalizedInput);
  const cached = await readAnalyzerCache<MintIntent>(key, params.cacheStats);
  if (cached) { params.log('success', 'cache', 'Cache hit: Contract Resolution'); return cached; }
  params.log('info', 'cache', 'Cache miss: Contract Resolution');
  const intent = await resolveMintIntent(params.normalizedInput, params.logger, params.telemetry);
  await writeAnalyzerCache(key, intent, ANALYZER_CACHE_TTL.contractResolution);
  return intent;
}

// ── Social discovery with cache ───────────────────────────────────────────────

export async function runSocialDiscoveryWithCache(params: {
  input: string;
  intent: MintIntent;
  enabled: boolean;
  cacheStats: AnalyzerCacheStats;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}) {
  const key = ANALYZER_CACHE_KEYS.discoveryResults(params.intent.sourceUrl || params.input);
  const cached = await readAnalyzerCache<ResolverResult>(key, params.cacheStats);
  if (cached) { params.log('success', 'cache', 'Cache hit: Discovery Results'); return cached; }
  params.log('info', 'cache', 'Cache miss: Discovery Results');
  const fresh = await runSocialDiscovery(params);
  await writeAnalyzerCache(key, fresh, ANALYZER_CACHE_TTL.discoveryResults);
  return fresh;
}

async function runSocialDiscovery(params: {
  input: string;
  intent: MintIntent;
  enabled: boolean;
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  timingBreakdown: AnalyzerTiming[];
}): Promise<ResolverResult> {
  if (!params.enabled) {
    params.log('warning', 'social_discovery', 'Social discovery skipped: auto-detect socials is disabled');
    return { socials: {}, socialHealth: getSocialHealth({}) };
  }

  let socials: AnalyzerSocials = {};
  const websiteCandidates = new Set<string>();
  const crawlCandidates = new Set<string>([params.intent.sourceUrl]);
  if (isLikelyProjectWebsite(params.input)) {
    const normalizedInput = normalizeUrlCandidate(params.input);
    if (normalizedInput) { websiteCandidates.add(normalizedInput); crawlCandidates.add(normalizedInput); }
  }

  params.log('info', 'social_discovery', 'Searching OpenSea metadata');
  try {
    const openSeaSocials = await runTimed(params.timingBreakdown, 'OpenSea Social Metadata',
      () => discoverOpenSeaMetadataSocials(params.intent.sourceUrl));
    socials = mergeAnalyzerSocials(socials, openSeaSocials);
    if (socials.website) { websiteCandidates.add(socials.website); crawlCandidates.add(socials.website); }
    params.log(Object.keys(openSeaSocials).length ? 'success' : 'warning', 'social_discovery',
      Object.keys(openSeaSocials).length ? 'OpenSea metadata socials loaded' : 'OpenSea metadata returned no socials');
  } catch (error) {
    params.log('warning', 'social_discovery', `OpenSea metadata social discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  params.log('info', 'social_discovery', 'Searching website metadata');
  for (const website of websiteCandidates) {
    try {
      const websiteSocials = await runTimed(params.timingBreakdown, 'Website Social Metadata',
        () => discoverWebsiteMetadataSocials(website));
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
      const result = await runTimed(params.timingBreakdown, 'Firecrawl Social Discovery',
        () => discoverWithFirecrawl(targetUrl));
      socials = mergeAnalyzerSocials(socials, socialsFromProviderResult(result));
      if (socials.website) websiteCandidates.add(socials.website);
      params.log('success', 'social_discovery', `Firecrawl discovery complete: ${targetUrl}`);
    } catch (error) {
      params.log('warning', 'social_discovery', `Firecrawl social discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const targetUrl of crawlCandidates) {
    params.log('info', 'social_discovery', 'Running Jina discovery');
    try {
      const result = await runTimed(params.timingBreakdown, 'Jina Social Discovery',
        () => discoverWithJina(targetUrl));
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
        if (!hasDiscoveryResult(result)) { params.log('warning', 'social_discovery', 'Browserbase failed: empty discovery response'); continue; }
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
