import 'server-only';

export type DiscoverySocials = {
  twitter?: string;
  discord?: string;
  instagram?: string;
  medium?: string;
  telegram?: string;
  external?: string;
};

export type DiscoveryProviderResult = {
  collectionName?: string;
  contract?: string;
  chain?: string;
  mintPrice?: string;
  mintTime?: string;
  mintStatus?: string;
  website?: string;
  socials?: DiscoverySocials;
  rawText?: string;
};

type JinaReaderResponse = {
  data?: {
    title?: string;
    description?: string;
    url?: string;
    content?: string;
  };
  title?: string;
  description?: string;
  url?: string;
  content?: string;
};

const CONTRACT_RE = /0x[a-fA-F0-9]{40}/;
const PRICE_RE = /(?:mint\s*)?(?:price|cost)\D{0,30}(\d+(?:\.\d+)?)\s*(ETH|WETH|MATIC|POL|USDC|USDT)/i;
const FALLBACK_PRICE_RE = /(\d+(?:\.\d+)?)\s*(ETH|WETH|MATIC|POL|USDC|USDT)/i;
const DATE_RE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:AM|PM|UTC|EST|EDT|PST|PDT|GMT)?)?/i;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/;

const SOCIAL_PATTERNS: Array<[keyof DiscoverySocials, RegExp]> = [
  ['twitter', /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s)"'<>]+/i],
  ['discord', /https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/[^\s)"'<>]+/i],
  ['instagram', /https?:\/\/(?:www\.)?instagram\.com\/[^\s)"'<>]+/i],
  ['medium', /https?:\/\/(?:www\.)?medium\.com\/[^\s)"'<>]+/i],
  ['telegram', /https?:\/\/t\.me\/[^\s)"'<>]+/i],
];

function normalizeReaderUrl(targetUrl: string) {
  const withoutProtocol = targetUrl.trim().replace(/^https?:\/\//i, '');
  return `https://r.jina.ai/http://${withoutProtocol}`;
}

function getJinaToken() {
  return process.env.JINA_API_KEY || process.env.JINA_READER_API_KEY;
}

function normalizeChain(value: string | undefined) {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (lower.includes('ethereum') || lower === 'eth') return 'ethereum';
  if (lower.includes('base')) return 'base';
  if (lower.includes('polygon') || lower.includes('matic') || lower === 'pol') return 'polygon';
  return undefined;
}

function extractChain(text: string) {
  const chainLine = text.match(/(?:chain|network)\s*[:\-]\s*(ethereum|base|polygon|matic|eth|pol)\b/i);
  return normalizeChain(chainLine?.[1]) ?? normalizeChain(text.match(/\b(ethereum|base|polygon)\b/i)?.[1]);
}

function extractMintStatus(text: string) {
  const lower = text.toLowerCase();
  if (/\b(sold out|mint ended|sale ended|mint closed|ended)\b/.test(lower)) return 'ENDED';
  if (/\b(minting now|mint is live|public mint active|live now|mint now)\b/.test(lower)) return 'LIVE';
  if (/\b(upcoming|not started|starts at|starts on|mint opens|mint starts)\b/.test(lower)) return 'NOT_STARTED';
  return undefined;
}

function extractMintTime(text: string) {
  const labeled = text.match(/(?:mint|sale|public sale)\s*(?:starts?|opens?|time|date)\D{0,40}([^\n.]{6,120})/i)?.[1]?.trim();
  const iso = text.match(ISO_DATE_RE)?.[0];
  const date = text.match(DATE_RE)?.[0];
  return labeled || iso || date;
}

function extractMintPrice(text: string) {
  const match = text.match(PRICE_RE) ?? text.match(FALLBACK_PRICE_RE);
  if (!match) return undefined;
  return `${match[1]} ${match[2].toUpperCase()}`;
}

function extractCollectionName(title: string | undefined, text: string) {
  const cleanTitle = title
    ?.replace(/\s*[-|]\s*OpenSea.*$/i, '')
    .replace(/\s*\|\s*NFT.*$/i, '')
    .trim();
  if (cleanTitle) return cleanTitle;

  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/\s*[-|]\s*OpenSea.*$/i, '').trim();

  return undefined;
}

function cleanUrl(url: string) {
  return url.replace(/[),.;]+$/, '');
}

function extractSocials(text: string) {
  const socials: DiscoverySocials = {};

  for (const [key, pattern] of SOCIAL_PATTERNS) {
    const match = text.match(pattern)?.[0];
    if (match) socials[key] = cleanUrl(match);
  }

  const external = text
    .match(/https?:\/\/(?![^/\s]*opensea\.io)(?![^/\s]*(?:twitter\.com|x\.com|discord\.gg|discord\.com|instagram\.com|medium\.com|t\.me))[^\s)"'<>]+/i)?.[0];
  if (external) socials.external = cleanUrl(external);

  return socials;
}

export function extractDiscoveryFields(text: string, title?: string): DiscoveryProviderResult {
  const contract = text.match(CONTRACT_RE)?.[0]?.toLowerCase();
  const socials = extractSocials(text);

  return {
    collectionName: extractCollectionName(title, text),
    contract,
    chain: extractChain(text),
    mintPrice: extractMintPrice(text),
    mintTime: extractMintTime(text),
    mintStatus: extractMintStatus(text),
    website: socials.external,
    socials,
    rawText: text,
  };
}

export async function discoverWithJina(openseaUrl: string): Promise<DiscoveryProviderResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Return-Format': 'markdown',
  };
  const token = getJinaToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(normalizeReaderUrl(openseaUrl), {
    headers,
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`Jina discovery failed with status ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await response.json() as JinaReaderResponse;
    const data = json.data ?? json;
    const text = [data.title, data.description, data.content].filter(Boolean).join('\n\n');
    return extractDiscoveryFields(text, data.title);
  }

  const text = await response.text();
  return extractDiscoveryFields(text);
}
