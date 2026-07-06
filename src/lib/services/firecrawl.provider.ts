import 'server-only';

import { extractDiscoveryFields, type DiscoveryProviderResult } from '@/lib/services/discovery-extractor';

type FirecrawlScrapeResponse = {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    metadata?: Record<string, unknown>;
  };
};

function getFirecrawlApiKey() {
  return process.env.FIRECRAWL_API_KEY;
}

function getFirecrawlApiUrl() {
  return 'https://api.firecrawl.dev';
}

function metadataToText(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return '';

  return Object.entries(metadata)
    .map(([key, value]) => {
      if (typeof value === 'string') return `${key}: ${value}`;
      if (Array.isArray(value)) return `${key}: ${value.filter((item) => typeof item === 'string').join(' ')}`;
      if (value && typeof value === 'object') return `${key}: ${JSON.stringify(value)}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function mergeMetadata(result: DiscoveryProviderResult, metadata: Record<string, unknown> | undefined) {
  if (!metadata) return result;

  const title = typeof metadata.title === 'string' ? metadata.title : undefined;
  const ogTitle = typeof metadata.ogTitle === 'string' ? metadata.ogTitle : undefined;
  const sourceUrl = typeof metadata.sourceURL === 'string' ? metadata.sourceURL : undefined;
  const url = typeof metadata.url === 'string' ? metadata.url : undefined;

  return {
    ...result,
    collectionName: result.collectionName || ogTitle || title,
    website: result.website || sourceUrl || url,
  };
}

export async function discoverWithFirecrawl(openseaUrl: string): Promise<DiscoveryProviderResult> {
  const apiKey = getFirecrawlApiKey();
  if (!apiKey) {
    const error = new Error('FIRECRAWL_API_KEY is not configured');
    throw error;
  }

  const response = await fetch(`${getFirecrawlApiUrl()}/v1/scrape`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: openseaUrl,
      formats: ['markdown', 'html'],
      onlyMainContent: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(text || `Firecrawl discovery failed with status ${response.status}`);
    throw error;
  }

  const json = await response.json() as FirecrawlScrapeResponse;
  if (json.success === false) {
    const error = new Error(json.error || 'Firecrawl discovery failed');
    throw error;
  }

  const data = json.data ?? {};
  const text = [
    metadataToText(data.metadata),
    data.markdown,
    data.html,
    data.rawHtml,
  ].filter(Boolean).join('\n\n');

  return mergeMetadata(extractDiscoveryFields(text, typeof data.metadata?.title === 'string' ? data.metadata.title : undefined), data.metadata);
}
