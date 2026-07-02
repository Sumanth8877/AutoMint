import 'server-only';

/**
 * Shared discovery types and text-extraction utilities.
 * Previously in jina.provider.ts — extracted here so Firecrawl and other
 * providers can use them without depending on Jina.
 */

export type DiscoverySocials = {
  website?: string;
  twitter?: string;
  discord?: string;
  instagram?: string;
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

// ── Regex patterns ────────────────────────────────────────────────────────────
const CONTRACT_SCAN_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const PRICE_RE = /(?:mint\s*)?(?:price|cost)\D{0,30}(\d+(?:\.\d+)?)\s*(ETH|WETH|MATIC|POL|USDC|USDT)/i;
const FALLBACK_PRICE_RE = /(\d+(?:\.\d+)?)\s*(ETH|WETH|MATIC|POL|USDC|USDT)/i;
const DATE_RE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:AM|PM|UTC|EST|EDT|PST|PDT|GMT)?)?/i;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/;

const SOCIAL_PATTERNS: Array<[keyof DiscoverySocials, RegExp]> = [
  ['twitter', /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^\s)"'<>]+/i],
  ['discord', /https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/[^\s)"'<>]+/i],
  ['instagram', /https?:\/\/(?:www\.)?instagram\.com\/[^\s)"'<>]+/i],
  ['telegram', /https?:\/\/(?:t\.me|telegram\.me)\/[^\s)"'<>]+/i],
];

// ── Private helpers ───────────────────────────────────────────────────────────

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
  const cleanTitle = title?.replace(/\s*[-|]\s*(OpenSea|NFT|Marketplace).*$/i, '').trim();
  if (cleanTitle) return cleanTitle;
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/\s*[-|]\s*OpenSea.*$/i, '').trim();
  return undefined;
}

function cleanUrl(url: string) {
  return url.replace(/[),.;]+$/, '');
}

function isAllowedExternalUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const blockedHosts = [
      'opensea.io', 'twitter.com', 'x.com', 'discord.gg', 'discord.com',
      ['git', 'hub.com'].join(''), 'instagram.com', ['med', 'ium.com'].join(''),
      't.me', 'telegram.me',
    ];
    return !blockedHosts.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function extractSocials(text: string): DiscoverySocials {
  const socials: DiscoverySocials = {};
  for (const [key, pattern] of SOCIAL_PATTERNS) {
    const match = text.match(pattern)?.[0];
    if (match) socials[key] = cleanUrl(match);
  }
  const external = text.match(/https?:\/\/[^\s)"'<>]+/ig)?.map(cleanUrl).find(isAllowedExternalUrl);
  if (external) socials.external = cleanUrl(external);
  return socials;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract NFT mint discovery fields from raw page text/markdown.
 * Used by Firecrawl (and previously Jina) after fetching page content.
 */
// Fix #4: previously matched the first 0x address ANYWHERE in the page with
// no contextual filtering (see mint-discovery.service.ts for the same fix
// applied to the higher-stakes custom-mint-site discovery tier). Now prefers
// a block-explorer-linked address, then a uniquely-labeled "contract/address"
// match, then falls back to a bare first-match ONLY if it's the single
// unambiguous address on the page.
const EXPLORER_LINK_RE = /(?:etherscan\.io|basescan\.org|polygonscan\.com|arbiscan\.io)\/(?:address|token|nft)\/(0x[a-fA-F0-9]{40})/i;
const CONTRACT_NEARBY_RE = /(?:contract|address|addr)[^\n]{0,40}(0x[a-fA-F0-9]{40})/ig;

function extractContractAddress(text: string): string | undefined {
  const explorerMatch = text.match(EXPLORER_LINK_RE)?.[1];
  if (explorerMatch) return explorerMatch.toLowerCase();

  const nearby = Array.from(text.matchAll(CONTRACT_NEARBY_RE)).map((m) => m[1].toLowerCase());
  const distinctNearby = Array.from(new Set(nearby));
  if (distinctNearby.length === 1) return distinctNearby[0];

  const distinctAll = Array.from(new Set((text.match(CONTRACT_SCAN_RE) ?? []).map((a) => a.toLowerCase())));
  if (distinctAll.length === 1) return distinctAll[0];

  // Ambiguous (0 or 2+ candidates with no stronger signal) — don't guess.
  return undefined;
}

export function extractDiscoveryFields(text: string, title?: string): DiscoveryProviderResult {
  const contract = extractContractAddress(text);
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
