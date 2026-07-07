import 'server-only';

import { logger } from '@/lib/logger';
import { getSetting } from '@/lib/services/integration-settings.service';

// ─── socialdata.tools provider ───────────────────────────────────────────
// A thin, dependency-free wrapper around https://socialdata.tools/ — the
// cheapest reliable Twitter/X data provider (~$0.0002 per tweet).
//
// Why this and not Twitter's official API?
//   - Twitter API v2 Basic tier costs $100/mo minimum with tight rate limits.
//   - socialdata.tools uses residential proxies + logged-in sessions and
//     returns full tweet objects (author, media, quote tweets) via REST.
//   - No OAuth dance — just an API key in the Authorization header.
//
// SocialData docs: https://docs.socialdata.tools/
//
// Endpoints used:
//   GET /twitter/user/{screen_name}                → resolve @handle to id_str
//   GET /twitter/user/{user_id}/tweets             → last ~20 tweets, newest first
//   GET /twitter/user/{user_id}/tweets?cursor=...  → pagination cursor
//
// If SOCIALDATA_API_KEY is not configured, every call throws a
// TwitterProviderError — routes should surface a clear "connect the
// provider in Settings → Integrations" message to the user.

const SOCIALDATA_BASE = 'https://api.socialdata.tools';
const DEFAULT_TIMEOUT_MS = 20_000;

// ─── Types ───────────────────────────────────────────────────────────────

export type TwitterUser = {
  id_str: string;
  screen_name: string;
  name: string;
  profile_image_url_https: string | null;
  followers_count: number;
  verified: boolean;
};

export type TwitterTweet = {
  id_str: string;
  full_text: string;
  created_at: string;         // e.g. "Mon Dec 05 12:34:56 +0000 2024"
  user: {
    id_str: string;
    screen_name: string;
    name: string;
  };
  entities?: {
    urls?: Array<{ url: string; expanded_url: string }>;
  };
  is_retweet?: boolean;
  is_quote_status?: boolean;
};

export class TwitterProviderError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'TwitterProviderError';
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────

async function getApiKey(): Promise<string> {
  // 1. Env var takes precedence (for local dev / CI).
  if (process.env.SOCIALDATA_API_KEY) {
    return process.env.SOCIALDATA_API_KEY;
  }
  // 2. Encrypted DB setting managed via Settings → Integrations.
  const setting = await getSetting('SOCIALDATA_API_KEY');
  if (!setting?.value) {
    throw new TwitterProviderError(
      'SOCIALDATA_API_KEY is not configured. Add it in Settings → Integrations.',
      401,
      'MISSING_API_KEY',
    );
  }
  return setting.value;
}

// ─── HTTP helper ─────────────────────────────────────────────────────────

async function socialDataFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const apiKey = await getApiKey();
  const url = new URL(`${SOCIALDATA_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      logger.warn('socialdata.tools request failed', {
        area: 'twitter',
        status: response.status,
        path,
        bodyPreview: bodyText.slice(0, 200),
      });
      throw new TwitterProviderError(
        `Twitter provider returned ${response.status}: ${bodyText.slice(0, 200)}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof TwitterProviderError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new TwitterProviderError('Twitter provider request timed out', 504, 'TIMEOUT');
    }
    throw new TwitterProviderError(
      `Twitter provider error: ${(error as Error).message}`,
      500,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Normalize a handle: strip leading @, lowercase, strip URL fragments.
 * Accepts any of: "PudgyPenguins", "@PudgyPenguins", "twitter.com/PudgyPenguins",
 * "https://x.com/PudgyPenguins/status/…" → returns "pudgypenguins".
 */
export function normalizeHandle(input: string): string {
  const trimmed = input.trim();
  // Extract from URL if present.
  const urlMatch = trimmed.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i);
  const raw = urlMatch ? urlMatch[1] : trimmed.replace(/^@+/, '');
  return raw.toLowerCase();
}

/**
 * Look up a Twitter user by screen_name (without the @).
 * Cached at the caller layer — this always does a fresh HTTP request.
 */
export async function getUserByScreenName(screenName: string): Promise<TwitterUser> {
  const clean = normalizeHandle(screenName);
  return socialDataFetch<TwitterUser>(`/twitter/user/${encodeURIComponent(clean)}`);
}

/**
 * Fetch tweets for a user by id_str.
 * SocialData returns newest-first. When `sinceId` is supplied, we ask them
 * to filter server-side — but they don't guarantee it, so the caller MUST
 * also filter by `id_str > sinceId` before persisting.
 *
 * Returns at most ~20 tweets per call (the provider's page size). For most
 * WL projects that's several days of tweets and more than enough for our
 * 5–30-minute polling cadence.
 */
export async function getUserTweets(
  userId: string,
  options: { sinceId?: string | null } = {},
): Promise<TwitterTweet[]> {
  const params: Record<string, string> = {};
  if (options.sinceId) params.since_id = options.sinceId;

  type ListResponse = { tweets: TwitterTweet[] };
  const response = await socialDataFetch<ListResponse | TwitterTweet[]>(
    `/twitter/user/${encodeURIComponent(userId)}/tweets`,
    params,
  );

  // The endpoint has returned both shapes historically — be defensive.
  const tweets = Array.isArray(response) ? response : (response.tweets ?? []);

  // Belt-and-suspenders filter: only tweets strictly newer than sinceId.
  if (options.sinceId) {
    return tweets.filter((t) => bigIntGt(t.id_str, options.sinceId!));
  }
  return tweets;
}

/**
 * Compare two Twitter id_str values numerically without pulling in BigInt
 * comparisons everywhere. Twitter IDs are up to 19 digits — beyond Number
 * precision — so we compare as strings after zero-padding.
 */
function bigIntGt(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

/**
 * Extract the first outbound URL from a tweet (usually the mint link, form
 * link, or thread link). Prefers `expanded_url` over the shortened t.co.
 */
export function extractFirstUrl(tweet: TwitterTweet): string | null {
  const urls = tweet.entities?.urls ?? [];
  const first = urls[0];
  if (!first) return null;
  return first.expanded_url || first.url;
}
