import 'server-only';

import OpenAI from 'openai';
import { logger } from '@/lib/logger';
import { getSetting } from '@/lib/services/integration-settings.service';

// ─── AI classifier for WL Tracker ────────────────────────────────────────
// Given a tweet from a project the user has applied to, decide:
//   - what kind of tweet is it? (winners announcement, mint link, hype, …)
//   - how urgent is it? (critical → wake user via Telegram, low → skip)
//   - what mint URL, if any, is embedded?
//
// Uses OpenRouter with a free/fast model (llama-3.1-8b) so per-tweet cost
// is effectively zero. The system prompt is short, explicit, and asks for
// strict JSON — parsing failures fall back to a permissive "medium/general_hype"
// classification so we never lose interesting tweets to a parse error.

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
// This model is free on OpenRouter, ~fast, and good enough for JSON-mode
// classification. If it disappears from the free tier the classifier falls
// back to the environment override below.
const DEFAULT_CLASSIFIER_MODEL =
  process.env.WL_CLASSIFIER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free';

// ─── Types ───────────────────────────────────────────────────────────────

export type WlCategory =
  | 'winners_announcement'
  | 'mint_link'
  | 'mint_reminder'
  | 'delay_postpone'
  | 'general_hype'
  | 'unrelated';

export type WlUrgency = 'critical' | 'high' | 'medium' | 'low';

export type WlClassification = {
  category: WlCategory;
  urgency: WlUrgency;
  mint_url: string | null;
  wallet_check_needed: boolean;
  summary: string;
};

// ─── Client ──────────────────────────────────────────────────────────────

async function getOpenRouterClient(): Promise<OpenAI> {
  const apiKey =
    process.env.OPENROUTER_API_KEY ||
    (await getSetting('OPENROUTER_API_KEY'))?.value;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY not configured — required for WL tweet classification. Set it in Settings → Integrations.',
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE,
    defaultHeaders: {
      'HTTP-Referer': 'https://automint.app',
      'X-Title': 'AutoMint WL Tracker',
    },
  });
}

// ─── System prompt ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a tweet classifier for an NFT allowlist tracker.

The user has manually applied to a WL/allowlist for the given NFT project and
now wants to be notified only when the project posts something ACTIONABLE
about winners, minting, or delays. Ignore generic hype and community chatter.

Return STRICT JSON matching this schema — no prose, no code fences:
{
  "category": "winners_announcement" | "mint_link" | "mint_reminder" | "delay_postpone" | "general_hype" | "unrelated",
  "urgency": "critical" | "high" | "medium" | "low",
  "mint_url": string | null,
  "wallet_check_needed": boolean,
  "summary": string (max 140 chars, plain text)
}

Category definitions:
- winners_announcement: WL winners announced OR "check your DMs" OR a list of winning wallets.
- mint_link: Public mint page / mint.fun / opensea / project site URL for THIS mint.
- mint_reminder: Reminder that mint is happening within the next 24h.
- delay_postpone: Mint delayed / rescheduled / cancelled.
- general_hype: Marketing hype, teasers, general project updates.
- unrelated: Off-topic, reply threads, meme replies, non-project content.

Urgency rules:
- critical: winners just announced OR mint is LIVE now.
- high: mint link posted, or mint starting within a few hours.
- medium: reminders, delays, schedule changes.
- low: hype, teasers.

wallet_check_needed: true only if the tweet mentions specific wallet addresses
or asks users to check DMs for individual results.`;

// ─── Classify ────────────────────────────────────────────────────────────

export async function classifyTweet(input: {
  projectName: string;
  projectHandle: string;
  tweetText: string;
  postedAt: Date;
}): Promise<WlClassification> {
  const userPrompt = [
    `Project: ${input.projectName} (${input.projectHandle})`,
    `Posted: ${input.postedAt.toISOString()}`,
    `Tweet:`,
    `"""`,
    input.tweetText.slice(0, 2000), // hard cap
    `"""`,
    ``,
    `Classify.`,
  ].join('\n');

  try {
    const client = await getOpenRouterClient();
    const completion = await client.chat.completions.create({
      model: DEFAULT_CLASSIFIER_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    return parseClassification(raw);
  } catch (error) {
    // On any AI failure, fall through to a safe default that keeps the
    // tweet visible in the feed as low-urgency — we prefer false positives
    // over silently dropping potentially-important tweets.
    logger.warn('WL classifier: AI call failed, using safe fallback', {
      area: 'wl-classifier',
      error: (error as Error).message,
    });
    return {
      category: 'general_hype',
      urgency: 'low',
      mint_url: null,
      wallet_check_needed: false,
      summary: input.tweetText.slice(0, 140),
    };
  }
}

function parseClassification(raw: string): WlClassification {
  try {
    const parsed = JSON.parse(raw) as Partial<WlClassification>;
    const category = validCategory(parsed.category);
    const urgency = validUrgency(parsed.urgency);
    return {
      category,
      urgency,
      mint_url: typeof parsed.mint_url === 'string' && parsed.mint_url ? parsed.mint_url : null,
      wallet_check_needed: parsed.wallet_check_needed === true,
      summary: (parsed.summary ?? '').toString().slice(0, 140),
    };
  } catch {
    // Model returned non-JSON — extremely rare with response_format=json_object
    // but handle it anyway.
    return {
      category: 'general_hype',
      urgency: 'low',
      mint_url: null,
      wallet_check_needed: false,
      summary: raw.slice(0, 140),
    };
  }
}

function validCategory(v: unknown): WlCategory {
  const allowed: WlCategory[] = [
    'winners_announcement',
    'mint_link',
    'mint_reminder',
    'delay_postpone',
    'general_hype',
    'unrelated',
  ];
  return allowed.includes(v as WlCategory) ? (v as WlCategory) : 'general_hype';
}

function validUrgency(v: unknown): WlUrgency {
  const allowed: WlUrgency[] = ['critical', 'high', 'medium', 'low'];
  return allowed.includes(v as WlUrgency) ? (v as WlUrgency) : 'low';
}
