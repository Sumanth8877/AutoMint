import 'server-only';

import { getCache, setCache } from '@/lib/redis';

export const ANALYZER_CACHE_TTL = {
  contractResolution: 86_400,
  collectionMetadata: 3_600,
  discoveryResults: 3_600,
  marketMetrics: 600,
} as const;

export const ANALYZER_CACHE_KEYS = {
  contractResolution: (input: string) => `analyzer:contract:${encodeURIComponent(input.trim().toLowerCase())}`,
  collectionMetadata: (contract: string, chain: string) => `analyzer:collection:${chain}:${contract.toLowerCase()}`,
  discoveryResults: (input: string) => `analyzer:discovery:${encodeURIComponent(input.trim().toLowerCase())}`,
  marketMetrics: (contract: string, chain: string) => `analyzer:market:${chain}:${contract.toLowerCase()}`,
} as const;

export type AnalyzerCacheStats = {
  hits: number;
  misses: number;
};

export function createAnalyzerCacheStats(): AnalyzerCacheStats {
  return { hits: 0, misses: 0 };
}

export function cacheHitRate(stats: AnalyzerCacheStats) {
  const total = stats.hits + stats.misses;
  return total > 0 ? Math.round((stats.hits / total) * 100) : 0;
}

export async function readAnalyzerCache<T>(key: string, stats?: AnalyzerCacheStats) {
  const cached = await getCache<T>(key);
  if (cached === null) {
    if (stats) stats.misses += 1;
    return null;
  }
  if (stats) stats.hits += 1;
  return cached;
}

export async function writeAnalyzerCache<T>(key: string, value: T, ttl: number) {
  await setCache(key, value, ttl);
}
