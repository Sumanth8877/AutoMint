import 'server-only';

import { getCache, setCache } from '@/lib/redis';
import { discoverWithFirecrawl } from '@/lib/services/firecrawl.provider';
import { discoverWithJina, type DiscoveryProviderResult, type DiscoverySocials } from '@/lib/services/jina.provider';
import { addBreadcrumb, captureException, startSpan } from '@/lib/observability/sentry';

const DISCOVERY_TTL_SECONDS = 24 * 60 * 60;
const REQUIRED_FIELDS = ['contract', 'chain', 'mintPrice', 'mintStatus', 'mintTime'] as const;

type RequiredDiscoveryField = (typeof REQUIRED_FIELDS)[number];

export type DiscoveryResult = {
  collectionName: string | null;
  contract: string | null;
  chain: string | null;
  mintPrice: string | null;
  mintTime: string | null;
  mintStatus: string | null;
  website: string | null;
  socials: DiscoverySocials;
};

function parseOpenSeaUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Discovery input must be a valid OpenSea URL');
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'opensea.io' && !host.endsWith('.opensea.io')) {
    throw new Error('Discovery input must be an OpenSea URL');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const collectionIndex = segments.findIndex((segment) => segment === 'collection' || segment === 'collections');
  const slug = collectionIndex >= 0 ? segments[collectionIndex + 1] : undefined;

  if (!slug) {
    throw new Error('OpenSea collection slug was not found');
  }

  return {
    url: url.toString(),
    slug: decodeURIComponent(slug).toLowerCase(),
  };
}

function getCacheKey(slug: string) {
  return `collection:${slug}`;
}

function valueOrNull(value: string | undefined | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeContract(value: string | undefined | null) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  return /^0x[a-f0-9]{40}$/.test(trimmed) ? trimmed : null;
}

function normalizeChain(value: string | undefined | null) {
  const lower = value?.trim().toLowerCase();
  if (!lower) return null;
  if (lower === 'eth' || lower === 'ethereum') return 'ethereum';
  if (lower === 'base') return 'base';
  if (lower === 'matic' || lower === 'polygon' || lower === 'pol') return 'polygon';
  return lower;
}

function normalizeMintStatus(value: string | undefined | null) {
  const lower = value?.trim().toLowerCase();
  if (!lower) return null;
  if (lower.includes('live')) return 'LIVE';
  if (lower.includes('not') || lower.includes('upcoming') || lower.includes('start')) return 'NOT_STARTED';
  if (lower.includes('end') || lower.includes('sold out') || lower.includes('closed')) return 'ENDED';
  if (lower === 'unknown') return 'UNKNOWN';
  return value?.trim() || null;
}

function toDiscoveryResult(result: DiscoveryProviderResult): DiscoveryResult {
  return {
    collectionName: valueOrNull(result.collectionName),
    contract: normalizeContract(result.contract),
    chain: normalizeChain(result.chain),
    mintPrice: valueOrNull(result.mintPrice),
    mintTime: valueOrNull(result.mintTime),
    mintStatus: normalizeMintStatus(result.mintStatus),
    website: valueOrNull(result.website),
    socials: result.socials ?? {},
  };
}

function isMissing(value: string | null | undefined) {
  return !value || value === 'UNKNOWN';
}

function getMissingRequiredFields(result: DiscoveryResult): RequiredDiscoveryField[] {
  return REQUIRED_FIELDS.filter((field) => isMissing(result[field]));
}

function mergeSocials(
  primary: DiscoverySocials | undefined,
  fallback: DiscoverySocials | undefined,
) {
  return {
    ...(fallback ?? {}),
    ...(primary ?? {}),
  };
}

function mergeProviderResults(primary: DiscoveryProviderResult, fallback: DiscoveryProviderResult): DiscoveryProviderResult {
  return {
    collectionName: primary.collectionName || fallback.collectionName,
    contract: primary.contract || fallback.contract,
    chain: primary.chain || fallback.chain,
    mintPrice: primary.mintPrice || fallback.mintPrice,
    mintTime: primary.mintTime || fallback.mintTime,
    mintStatus: primary.mintStatus || fallback.mintStatus,
    website: primary.website || fallback.website,
    socials: mergeSocials(primary.socials, fallback.socials),
    rawText: primary.rawText || fallback.rawText,
  };
}

export async function discoverCollection(openseaUrl: string): Promise<DiscoveryResult> {
  return startSpan('discovery.collection', { area: 'discovery', url: openseaUrl }, async () => {
  const { url, slug } = parseOpenSeaUrl(openseaUrl);
  addBreadcrumb({ category: 'discovery', message: 'URL submitted', level: 'info', data: { url, slug } });
  const cacheKey = getCacheKey(slug);
  const cached = await getCache<DiscoveryResult>(cacheKey);

  if (cached) return cached;

  addBreadcrumb({ category: 'discovery', message: 'discovery started', level: 'info', data: { url, provider: 'jina' } });
  const jinaStartedAt = Date.now();
  const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
  let jinaResult: DiscoveryProviderResult;
  try {
    jinaResult = await discoverWithJina(url);
    await trackAnalyticsEvent({
      eventType: 'discovery',
      status: 'success',
      provider: 'jina',
      durationMs: Date.now() - jinaStartedAt,
      metadata: { url, slug },
    });
  } catch (error) {
    await trackAnalyticsEvent({
      eventType: 'discovery',
      status: 'failed',
      provider: 'jina',
      durationMs: Date.now() - jinaStartedAt,
      metadata: { url, slug },
    });
    throw error;
  }
  let result = toDiscoveryResult(jinaResult);

  if (getMissingRequiredFields(result).length > 0) {
    try {
      addBreadcrumb({ category: 'discovery', message: 'discovery fallback started', level: 'info', data: { url, provider: 'firecrawl', missing: getMissingRequiredFields(result) } });
      const firecrawlStartedAt = Date.now();
      const firecrawlResult = await discoverWithFirecrawl(url);
      await trackAnalyticsEvent({
        eventType: 'discovery',
        status: 'success',
        provider: 'firecrawl',
        durationMs: Date.now() - firecrawlStartedAt,
        metadata: { url, slug, missing: getMissingRequiredFields(result) },
      });
      result = toDiscoveryResult(mergeProviderResults(jinaResult, firecrawlResult));
    } catch (error) {
      console.error('Firecrawl discovery fallback failed:', error);
      await trackAnalyticsEvent({
        eventType: 'discovery',
        status: 'failed',
        provider: 'firecrawl',
        metadata: { url, slug, missing: getMissingRequiredFields(result) },
      });
      await captureException(error, {
        area: 'discovery',
        context: { url, provider: 'firecrawl', collection: slug },
        fingerprint: ['discovery', 'firecrawl', 'fallback'],
      });
    }
  }

  const normalized = {
    ...result,
    chain: result.chain || 'ethereum',
    mintStatus: result.mintStatus || 'UNKNOWN',
  };

  await setCache(cacheKey, normalized, DISCOVERY_TTL_SECONDS);
  addBreadcrumb({ category: 'discovery', message: 'discovery completed', level: 'info', data: { url, slug, collection: normalized.collectionName, contract: normalized.contract } });
  return normalized;
  });
}
