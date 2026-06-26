import 'server-only';

/**
 * mint-discovery.service.ts
 *
 * Tiered discovery for ALL mint requirements when the primary URL resolver
 * returns incomplete data (missing contract, price, function, timing, etc.).
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  DISCOVERY CHAIN                                                        │
 * │                                                                         │
 * │  Tier 1 — resolveMintIntent() + fetchMintRequirements()  (caller runs) │
 * │           On-chain RPC + structured URL parsing.                        │
 * │           Fast, accurate. May leave gaps on custom mint sites.          │
 * │                ↓ if ANY required field is still missing                 │
 * │  Tier 2 — Jina + Firecrawl  IN PARALLEL  (page scraping)               │
 * │           Markdown extraction. No browser needed. ~2-5s.               │
 * │                ↓ if critical fields still missing                       │
 * │  Tier 3 — Browserbase + Playwright  (full JS browser render)           │
 * │           Last resort. Handles countdown timers, lazy JS, iframes.     │
 * │           ~8-15s. Only fires when tiers 1+2 left gaps.                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * "Critical" fields that trigger escalation:
 *   contractAddress  — without this nothing works
 *   mintPrice        — needed for wallet balance check + tx calldata
 *   mintFunction     — needed to build the tx
 *   mintStartTime    — needed to schedule upcoming mints accurately
 *
 * Non-critical fields (filled in if found, not escalated for):
 *   mintEndTime, maxPerWallet, maxPerTx, chain (defaults to 'ethereum')
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredRequirements {
  // Core identity
  contractAddress?: string;
  chain?: string;

  // Execution requirements
  mintFunction?: string;   // e.g. 'mint', 'publicMint', 'claim'
  mintPrice?: string;      // ETH value as decimal string e.g. '0.05', '0' for free
  maxPerWallet?: number;
  maxPerTx?: number;

  // Timing
  mintStartTime?: Date;
  mintEndTime?: Date;

  // Mint phases (optional enrichment)
  mintPhases?: Array<{
    type: 'whitelist' | 'allowlist' | 'public';
    startTime?: Date;
    price?: string;
    proofRequired?: boolean;
  }>;

  // Meta
  collectionName?: string;
  totalSupply?: number;

  // Discovery provenance
  confidence: number;       // 0.0–1.0
  source: DiscoverySource;
  missingFields: string[];  // what we still couldn't find
}

export type DiscoverySource =
  | 'url-resolver'
  | 'jina'
  | 'firecrawl'
  | 'browserbase'
  | 'merged';

// Fields that, if missing, escalate discovery to next tier
const CRITICAL_FIELDS: Array<keyof DiscoveredRequirements> = [
  'contractAddress',
  'mintPrice',
  'mintFunction',
  'mintStartTime',
];

// ─── Content extraction ───────────────────────────────────────────────────────

/**
 * Extract ALL mint requirements from raw page content (markdown, HTML, or text).
 * Called with content from Jina, Firecrawl, or Browserbase.
 */
export function extractRequirementsFromContent(
  content: string,
  pageUrl: string,
): Omit<DiscoveredRequirements, 'confidence' | 'source' | 'missingFields'> {
  const result: Omit<DiscoveredRequirements, 'confidence' | 'source' | 'missingFields'> = {};

  // ── Contract address ──────────────────────────────────────────────────────
  // Prefer 0x addresses near "contract" / "address" keywords, fall back to first found
  const contractNearby = content.match(
    /(?:contract|address|addr)[^\n]{0,40}(0x[a-fA-F0-9]{40})/i,
  );
  const contractAnywhere = content.match(/\b(0x[a-fA-F0-9]{40})\b/);
  const rawContract = contractNearby?.[1] ?? contractAnywhere?.[1];
  if (rawContract) result.contractAddress = rawContract.toLowerCase();

  // ── Chain detection ───────────────────────────────────────────────────────
  const lower = content.toLowerCase();
  const urlLower = pageUrl.toLowerCase();

  if (
    urlLower.includes('base.org') ||
    urlLower.includes('basescan.io') ||
    urlLower.includes('base.blockscout') ||
    lower.includes('base mainnet') ||
    lower.includes('chain: base') ||
    lower.includes('"chain":"base"') ||
    lower.includes("'base'")
  ) {
    result.chain = 'base';
  } else if (
    urlLower.includes('polygonscan.com') ||
    urlLower.includes('polygon.technology') ||
    lower.includes('polygon mainnet') ||
    lower.includes('chain: polygon')
  ) {
    result.chain = 'polygon';
  } else if (
    urlLower.includes('solana') ||
    urlLower.includes('magiceden.io') ||
    lower.includes('solana') ||
    lower.includes('sol mint')
  ) {
    result.chain = 'solana';
  } else if (
    urlLower.includes('etherscan.io') ||
    urlLower.includes('ethereum') ||
    lower.includes('ethereum mainnet')
  ) {
    result.chain = 'ethereum';
  }

  // ── Mint price ────────────────────────────────────────────────────────────
  // 1. Free mint keywords
  if (/free\s+mint|mint\s+(?:is\s+)?free|price[:\s]+0(?:\.0+)?\s*eth/i.test(content)) {
    result.mintPrice = '0';
  }

  if (!result.mintPrice) {
    // 2. "X ETH" near mint-related keywords
    const priceNearMint = content.match(
      /(?:mint|price|cost|value)[^\n]{0,60}(\d+(?:\.\d+)?)\s*ETH/i,
    );
    if (priceNearMint) result.mintPrice = priceNearMint[1];
  }

  if (!result.mintPrice) {
    // 3. JSON fields
    const jsonPrice = content.match(
      /"(?:price|mintPrice|publicMintPrice|cost)"\s*:\s*"?(\d+(?:\.\d+)?)"?/i,
    );
    if (jsonPrice) {
      const raw = parseFloat(jsonPrice[1]);
      // If it's a large integer it's likely wei → convert
      result.mintPrice =
        raw > 1000 ? (raw / 1e18).toFixed(6) : String(raw);
    }
  }

  if (!result.mintPrice) {
    // 4. Wei value from contract call patterns e.g. value: 50000000000000000
    const weiMatch = content.match(
      /(?:value|price|mintPrice)[^:]*:\s*(1\d{15,17}|[5-9]\d{15,16})\b/,
    );
    if (weiMatch) {
      result.mintPrice = (parseInt(weiMatch[1], 10) / 1e18).toFixed(6);
    }
  }

  // ── Mint function name ────────────────────────────────────────────────────
  const knownFunctions = [
    'publicMint',
    'mintPublic',
    'safeMint',
    'mintNFT',
    'claimTokens',
    'mintTokens',
    'buyTokens',
    'claim',
    'mint',        // generic — keep last (lowest priority)
  ] as const;

  for (const fn of knownFunctions) {
    // Match function name in ABI JSON, Solidity snippet, or plain text
    const pattern = new RegExp(
      `(?:"name"\\s*:\\s*"${fn}"|function\\s+${fn}\\s*\\(|\\b${fn}\\b)`,
      'i',
    );
    if (pattern.test(content)) {
      result.mintFunction = fn;
      break;
    }
  }

  // ── Max per wallet ────────────────────────────────────────────────────────
  const maxWalletMatch = content.match(
    /(?:max(?:imum)?|limit(?:ed)?)\s+(?:of\s+)?(\d+)\s+(?:per\s+)?(?:wallet|address|account)/i,
  ) ?? content.match(/"(?:maxPerWallet|maxMintPerWallet|walletLimit)"\s*:\s*(\d+)/i);
  if (maxWalletMatch) result.maxPerWallet = parseInt(maxWalletMatch[1], 10);

  // ── Max per transaction ───────────────────────────────────────────────────
  const maxTxMatch = content.match(
    /(?:max(?:imum)?|limit(?:ed)?)\s+(?:of\s+)?(\d+)\s+per\s+(?:tx|transaction)/i,
  ) ?? content.match(/"(?:maxPerTx|maxMintPerTx|txLimit)"\s*:\s*(\d+)/i);
  if (maxTxMatch) result.maxPerTx = parseInt(maxTxMatch[1], 10);

  // ── Mint start time ───────────────────────────────────────────────────────
  const now = Date.now();
  const startTimeCandidates: Date[] = [];

  const DATETIME_PATTERNS = [
    // ISO 8601 with timezone  e.g. 2024-04-20T18:00:00Z
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))/g,
    // ISO without TZ  e.g. 2024-04-20 18:00:00
    /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/g,
    // Unix seconds inside known keys  e.g. "startTime":1713628800
    /"(?:startTime|start_time|mintStart|openTime|launchTime|openAt|startDate)"\s*:\s*(\d{10})/g,
    // Unix ms  e.g. "startTime":1713628800000
    /"(?:startTime|start_time|mintStart|openTime|launchTime|openAt|startDate)"\s*:\s*(\d{13})/g,
    // Human-readable  e.g. April 20, 2024 at 6:00 PM EST
    /((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\s+(?:at\s+)?\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s+[A-Z]{2,5})?)/gi,
    // Short date + time  e.g. 04/20/2024 18:00 UTC
    /(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{2}:\d{2}(?:\s+[A-Z]{2,5})?)/g,
  ];

  for (const pat of DATETIME_PATTERNS) {
    pat.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(content)) !== null) {
      const raw = m[1];
      const d = /^\d{10}$/.test(raw)
        ? new Date(parseInt(raw, 10) * 1000)
        : /^\d{13}$/.test(raw)
        ? new Date(parseInt(raw, 10))
        : new Date(raw);
      if (!isNaN(d.getTime())) startTimeCandidates.push(d);
    }
  }

  if (startTimeCandidates.length > 0) {
    // Prefer earliest future date; fall back to most recent past date
    const future = startTimeCandidates.filter((d) => d.getTime() > now);
    result.mintStartTime =
      future.length > 0
        ? future.reduce((a, b) => (a < b ? a : b))
        : startTimeCandidates.reduce((a, b) => (a > b ? a : b));
  }

  // ── Mint end time ─────────────────────────────────────────────────────────
  // Look for end time keywords specifically
  const endTimeMatch = content.match(
    /"(?:endTime|end_time|mintEnd|closeTime|endDate)"\s*:\s*(\d{10,13})/,
  );
  if (endTimeMatch) {
    const raw = parseInt(endTimeMatch[1], 10);
    result.mintEndTime = new Date(raw > 9999999999 ? raw : raw * 1000);
  }

  // ── Mint phases ───────────────────────────────────────────────────────────
  const phases: DiscoveredRequirements['mintPhases'] = [];
  if (/allowlist|allow.?list/i.test(content)) {
    const alPrice = content.match(/allowlist[^\n]{0,80}(\d+(?:\.\d+)?)\s*ETH/i);
    phases.push({
      type: 'allowlist',
      price: alPrice?.[1],
      proofRequired: true,
    });
  }
  if (/whitelist|wl\s+mint|wl\s+price/i.test(content)) {
    const wlPrice = content.match(/whitelist[^\n]{0,80}(\d+(?:\.\d+)?)\s*ETH/i);
    phases.push({
      type: 'whitelist',
      price: wlPrice?.[1],
      proofRequired: true,
    });
  }
  if (/public\s+(?:mint|sale)|open\s+mint/i.test(content)) {
    phases.push({
      type: 'public',
      price: result.mintPrice,
      proofRequired: false,
    });
  }
  if (phases.length > 0) result.mintPhases = phases;

  // ── Collection name ───────────────────────────────────────────────────────
  const nameMatch =
    content.match(/"(?:name|collectionName|collection)"\s*:\s*"([^"]{2,80})"/i) ??
    content.match(/<title>([^<]{2,80})<\/title>/i);
  if (nameMatch) result.collectionName = nameMatch[1].trim();

  // ── Total supply ──────────────────────────────────────────────────────────
  const supplyMatch =
    content.match(/"(?:totalSupply|maxSupply|supply)"\s*:\s*(\d+)/i) ??
    content.match(/(?:total|max)\s+supply[:\s]+(\d{2,6})/i);
  if (supplyMatch) result.totalSupply = parseInt(supplyMatch[1], 10);

  return result;
}

// ─── Tier 2: Jina + Firecrawl ─────────────────────────────────────────────────

async function fetchViaJina(
  url: string,
): Promise<Omit<DiscoveredRequirements, 'confidence' | 'source' | 'missingFields'>> {
  const apiKey = process.env.JINA_API_KEY;
  // ✅ Bug #4 fixed: full URL passed directly — no http:// prefix added
  const jinaUrl = `https://r.jina.ai/${url}`;

  const res = await fetch(jinaUrl, {
    method: 'GET',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      Accept: 'text/plain',
    },
    signal: AbortSignal.timeout(4_000),
  });

  if (!res.ok) throw new Error(`Jina ${res.status}: ${res.statusText}`);
  const text = await res.text();

  console.log(`[mint-discovery] Jina returned ${text.length} chars for ${url}`);
  return extractRequirementsFromContent(text, url);
}

async function fetchViaFirecrawl(
  url: string,
): Promise<Omit<DiscoveredRequirements, 'confidence' | 'source' | 'missingFields'>> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY not configured');

  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      // Include script tags and structured data for richer extraction
      includeTags: ['script', 'meta'],
    }),
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) throw new Error(`Firecrawl ${res.status}: ${res.statusText}`);
  const data = (await res.json()) as { data?: { markdown?: string; html?: string } };
  const content = data?.data?.markdown ?? data?.data?.html ?? '';

  console.log(`[mint-discovery] Firecrawl returned ${content.length} chars for ${url}`);
  return extractRequirementsFromContent(content, url);
}

// ─── Tier 3: Browserbase + Playwright ─────────────────────────────────────────

async function fetchViaBrowserbase(
  url: string,
): Promise<Omit<DiscoveredRequirements, 'confidence' | 'source' | 'missingFields'>> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error('Browserbase not configured (BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID missing)');
  }

  // 1. Create session
  const sessionRes = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ projectId }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!sessionRes.ok) throw new Error(`Browserbase session ${sessionRes.status}`);
  const session = (await sessionRes.json()) as { id: string };

  try {
    // 2. Navigate
    const navRes = await fetch(`https://api.browserbase.com/v1/sessions/${session.id}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(6_000),
    });
    if (!navRes.ok) throw new Error(`Browserbase navigate ${navRes.status}`);

    // 3. Wait for JS execution (countdowns, lazy-loaded mint info)
    await new Promise((r) => setTimeout(r, 4000));

    // 4. Get full rendered content
    const contentRes = await fetch(`https://api.browserbase.com/v1/sessions/${session.id}/content`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!contentRes.ok) throw new Error(`Browserbase content ${contentRes.status}`);

    const data = (await contentRes.json()) as { content?: string };
    const content = data.content ?? '';

    console.log(`[mint-discovery] Browserbase returned ${content.length} chars for ${url}`);
    return extractRequirementsFromContent(content, url);
  } finally {
    // Best-effort cleanup — never let session leak block the response
    fetch(`https://api.browserbase.com/v1/sessions/${session.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => {});
  }
}

// ─── Merge helper ─────────────────────────────────────────────────────────────

/**
 * Merge two DiscoveredRequirements objects.
 * Values from `overlay` overwrite `base` only when the base field is missing/undefined.
 * i.e. earlier tiers' results take priority over later tiers'.
 */
function merge(
  base: Partial<DiscoveredRequirements>,
  overlay: Partial<DiscoveredRequirements>,
): Partial<DiscoveredRequirements> {
  return {
    contractAddress: base.contractAddress ?? overlay.contractAddress,
    chain: base.chain ?? overlay.chain,
    mintFunction: base.mintFunction ?? overlay.mintFunction,
    mintPrice: base.mintPrice ?? overlay.mintPrice,
    maxPerWallet: base.maxPerWallet ?? overlay.maxPerWallet,
    maxPerTx: base.maxPerTx ?? overlay.maxPerTx,
    mintStartTime: base.mintStartTime ?? overlay.mintStartTime,
    mintEndTime: base.mintEndTime ?? overlay.mintEndTime,
    mintPhases: base.mintPhases ?? overlay.mintPhases,
    collectionName: base.collectionName ?? overlay.collectionName,
    totalSupply: base.totalSupply ?? overlay.totalSupply,
  };
}

function computeMissing(req: Partial<DiscoveredRequirements>): string[] {
  return CRITICAL_FIELDS.filter((f) => req[f] === undefined || req[f] === null).map(String);
}

function computeConfidence(req: Partial<DiscoveredRequirements>): number {
  const fields: Array<keyof DiscoveredRequirements> = [
    'contractAddress', 'chain', 'mintFunction', 'mintPrice', 'mintStartTime',
  ];
  const found = fields.filter((f) => req[f] !== undefined && req[f] !== null).length;
  return found / fields.length;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * discoverMintRequirements
 *
 * The single entry point for mint requirement discovery across all 3 flows:
 *   - Telegram bot (mint-orchestrator.service.ts)
 *   - Home page instant mint (api/instant-mint/route.ts)
 *   - Mints page create task (api/mints/route.ts)
 *
 * @param url         The launchpad or mint URL
 * @param knownPartial  Fields already resolved by Tier 1 (URL resolver + on-chain RPC).
 *                    Pass everything you already have. Only missing fields escalate.
 *
 * @returns DiscoveredRequirements with all fields filled in (or still undefined if
 *          all 3 tiers exhausted), plus `missingFields` array and `confidence` score.
 *
 * ESCALATION LOGIC:
 *   - If ALL critical fields are already in knownPartial → skip Tier 2+3, return immediately.
 *   - If ANY critical field is missing → run Tier 2 (Jina + Firecrawl parallel).
 *   - If critical fields still missing after Tier 2 → run Tier 3 (Browserbase).
 *   - If contractAddress still missing after Tier 3 → throw (unresolvable URL).
 */
/**
 * discoverMintRequirements
 *
 * Tiered discovery (Tier 1 caller → Tier 2 Jina+Firecrawl → Tier 3 Browserbase).
 * Wrapped in a hard timeout so it never blocks the API response longer than
 * `maxTimeMs` — critical for Vercel hobby plan (10s function limit).
 *
 * If the timeout fires, returns whatever was resolved so far + a warning log.
 * Tier 3 (Browserbase) is automatically skipped when only <3s remain.
 */
export async function discoverMintRequirements(
  url: string,
  knownPartial: Partial<Omit<DiscoveredRequirements, 'confidence' | 'source' | 'missingFields'>> = {},
  options: { maxTimeMs?: number } = {},
): Promise<DiscoveredRequirements> {
  const maxTimeMs = options.maxTimeMs ?? 7000;        // 7s default — Vercel hobby safe
  const deadline = Date.now() + maxTimeMs;
  let current: Partial<DiscoveredRequirements> = { ...knownPartial };

  // Fast path: everything already known
  const initialMissing = computeMissing(current);
  if (initialMissing.length === 0) {
    console.log('[mint-discovery] All critical fields already resolved — skipping scraper tiers');
    return {
      ...current,
      confidence: 1.0,
      source: 'url-resolver',
      missingFields: [],
    } as DiscoveredRequirements;
  }

  console.log('[mint-discovery] Missing critical fields:', initialMissing, `— running Tier 2 (budget: ${maxTimeMs}ms)`);

  // ── Tier 2: Jina + Firecrawl in parallel, with budget check ───────────────
  let tier2Source: DiscoverySource = 'merged';
  try {
    const tier2Budget = Math.min(deadline - Date.now(), 6000);
    if (tier2Budget > 1500) {
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), tier2Budget),
      );

      const tier2Promise = Promise.allSettled([fetchViaJina(url), fetchViaFirecrawl(url)]);
      const result = await Promise.race([tier2Promise, timeoutPromise]);

      if (result !== null) {
        const [jinaResult, firecrawlResult] = result;
        let scraperMerged: Partial<DiscoveredRequirements> = {};

        if (jinaResult.status === 'fulfilled') {
          scraperMerged = merge(scraperMerged, jinaResult.value);
          tier2Source = 'jina';
        } else {
          console.warn('[mint-discovery] Jina failed:', jinaResult.reason);
        }
        if (firecrawlResult.status === 'fulfilled') {
          scraperMerged = merge(scraperMerged, firecrawlResult.value);
          if (tier2Source !== 'jina') tier2Source = 'firecrawl';
        } else {
          console.warn('[mint-discovery] Firecrawl failed:', firecrawlResult.reason);
        }
        current = merge(current, scraperMerged);
      } else {
        console.warn('[mint-discovery] Tier 2 budget exceeded — skipping Tier 3');
      }
    } else {
      console.warn('[mint-discovery] Insufficient budget for Tier 2 — skipping all scrapers');
    }
  } catch (err) {
    console.warn('[mint-discovery] Tier 2 threw:', err);
  }

  // ── Check Tier 3 budget ───────────────────────────────────────────────────
  const afterTier2Missing = computeMissing(current);
  const remainingMs = deadline - Date.now();

  if (afterTier2Missing.length === 0) {
    return {
      ...current,
      confidence: computeConfidence(current),
      source: tier2Source,
      missingFields: [],
    } as DiscoveredRequirements;
  }

  if (remainingMs < 3000) {
    // Skip Tier 3 — not enough budget for a full browser render
    console.warn('[mint-discovery] Skipping Tier 3 (Browserbase) — insufficient remaining budget:', remainingMs, 'ms');
    return {
      ...current,
      confidence: computeConfidence(current),
      source: tier2Source,
      missingFields: afterTier2Missing,
    } as DiscoveredRequirements;
  }

  console.log('[mint-discovery] Still missing after Tier 2:', afterTier2Missing, `— running Tier 3 (${remainingMs}ms left)`);

  // ── Tier 3: Browserbase + Playwright (with remaining time as timeout) ────
  try {
    const tier3Promise = fetchViaBrowserbase(url);
    const tier3Timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), remainingMs - 500));
    const bbResult = await Promise.race([tier3Promise, tier3Timeout]);
    if (bbResult !== null) {
      current = merge(current, bbResult);
      console.log('[mint-discovery] Tier 3 complete');
    } else {
      console.warn('[mint-discovery] Tier 3 timed out');
    }
  } catch (err) {
    console.warn('[mint-discovery] Tier 3 (Browserbase) failed:', err);
  }

  const finalMissing = computeMissing(current);
  const confidence = computeConfidence(current);

  if (!current.contractAddress) {
    throw new Error(
      `Could not resolve a contract address from this URL after all discovery tiers. ` +
      `URL: ${url}. ` +
      `Still missing: ${finalMissing.join(', ')}. ` +
      `Please verify this is a valid mint page.`,
    );
  }

  if (finalMissing.length > 0) {
    console.warn('[mint-discovery] Some fields still unresolved after all tiers:', finalMissing);
  }

  return {
    ...current,
    confidence,
    source: 'merged',
    missingFields: finalMissing,
  } as DiscoveredRequirements;
}
