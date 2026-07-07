import 'server-only';

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/redis';
import { publishEvent, type EventType } from '@/lib/services/event-bus.service';
import { recordSuccess, recordFailure, isProviderHealthy } from '@/lib/services/provider-health.service';
import { getSetting } from '@/lib/services/integration-settings.service';

// ── Provider config ─────────────────────────────────────────────────────────

type ProviderConfig = {
  name: string;
  baseURL: string;
  apiKey: string;
  defaultModel: string;
  models: AIModel[];
};

const GEMINI_MODELS: AIModel[] = [
  { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash \u2b50',     description: 'Most intelligent \u2014 frontier agentic performance' },
  { id: 'gemini-3.1-flash',      label: 'Gemini 3.1 Flash',        description: 'Cost-efficient \u2014 optimized for high-volume tasks' },
  { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',        description: 'Fast & reliable \u2014 solid all-rounder' },
  { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',          description: 'Deep reasoning \u2014 best for complex analysis' },
];

const NARA_MODELS: AIModel[] = [
  { id: 'mistral-large',      label: 'Mistral Large ⭐',      description: 'Recommended — smart, supports tools' },
  { id: 'mistral-medium-3-5', label: 'Mistral Medium 3.5',   description: 'Balanced — good speed & quality' },
];

const OPENROUTER_MODELS: AIModel[] = [
  // ── Free tier (verified working 2025) ────────────────────────────────────
  { id: 'meta-llama/llama-3.1-8b-instruct:free',   label: 'Llama 3.1 8B ⚡ FREE',    description: 'Default free — fast, reliable tool use' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free',  label: 'Llama 3.3 70B FREE',       description: 'Smarter free — better reasoning' },
  { id: 'mistralai/mistral-7b-instruct:free',      label: 'Mistral 7B FREE',          description: 'Tiny & quick — simple commands' },
  { id: 'google/gemma-3-9b-it:free',               label: 'Gemma 3 9B FREE',          description: 'Google free model' },
  // ── Paid ───────────────────────────────────────────────────────────────────────
  { id: 'google/gemini-2.5-flash',                 label: 'Gemini 2.5 Flash',         description: 'Best paid speed/quality ratio' },
  { id: 'anthropic/claude-3-5-haiku',              label: 'Claude 3.5 Haiku',         description: 'Lightweight & fast via OpenRouter' },
  { id: 'mistralai/mistral-large-2411',            label: 'Mistral Large',            description: 'Reliable paid fallback' },
];
// ── Multi-provider support ────────────────────────────────────────────────────
// Both Gemini AND Nara models are shown if their API keys are set.
// If one provider fails, the other is used as automatic fallback.

const GEMINI_MODEL_IDS = new Set(GEMINI_MODELS.map(m => m.id));
const NARA_MODEL_IDS       = new Set(NARA_MODELS.map(m => m.id));
const OPENROUTER_MODEL_IDS = new Set(OPENROUTER_MODELS.map(m => m.id));

/**
 * Resolve an API key: check DB (encrypted storage) first, then env var fallback.
 * This lets users change keys from the Settings UI without redeploying.
 */
async function resolveApiKey(settingKey: 'GEMINI_API_KEY' | 'NARA_API_KEY' | 'OPENROUTER_API_KEY'): Promise<string | null> {
  try {
    const dbSetting = await getSetting(settingKey);
    if (dbSetting?.value) return dbSetting.value;
  } catch { /* DB unavailable — fall through to env var */ }
  return process.env[settingKey] ?? null;
}

async function getGeminiProvider(): Promise<ProviderConfig | null> {
  const key = await resolveApiKey('GEMINI_API_KEY');
  if (!key) return null;
  return {
    name: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKey: key,
    defaultModel: 'gemini-3.5-flash',
    models: GEMINI_MODELS,
  };
}

async function getNaraProvider(): Promise<ProviderConfig | null> {
  const key = await resolveApiKey('NARA_API_KEY');
  if (!key) return null;
  return {
    name: 'NaraRouter',
    baseURL: 'https://router.bynara.id/v1',
    apiKey: key,
    defaultModel: 'mistral-large',
    models: NARA_MODELS,
  };
}

async function getOpenRouterProvider(): Promise<ProviderConfig | null> {
  const key = await resolveApiKey('OPENROUTER_API_KEY');
  if (!key) return null;
  return {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: key,
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    models: OPENROUTER_MODELS,
  };
}

/** Get all configured providers (can be 0, 1, or 2, or 3). */
async function getAllProviders(): Promise<ProviderConfig[]> {
  const [gemini, nara, openrouter] = await Promise.all([
    getGeminiProvider(), getNaraProvider(), getOpenRouterProvider(),
  ]);
  const providers: ProviderConfig[] = [];
  if (gemini) providers.push(gemini);
  if (nara) providers.push(nara);
  if (openrouter) providers.push(openrouter);
  return providers;
}

/** Resolve which provider owns a given model ID. */
async function resolveProviderForModel(modelId: string): Promise<ProviderConfig | null> {
  if (GEMINI_MODEL_IDS.has(modelId))       return getGeminiProvider();
  if (NARA_MODEL_IDS.has(modelId))         return getNaraProvider();
  if (OPENROUTER_MODEL_IDS.has(modelId))   return getOpenRouterProvider();
  return null;
}

/** Get the primary provider (first available — Gemini preferred). */
async function resolveProvider(): Promise<ProviderConfig | null> {
  return (await getGeminiProvider()) ?? (await getNaraProvider());
}

/** Get a fallback provider (the OTHER provider, not the given one). */
async function getFallbackProvider(currentName: string): Promise<ProviderConfig | null> {
  // Fallback chain: Gemini → OpenRouter → Nara (and vice versa)
  if (currentName === 'Gemini')      return (await getOpenRouterProvider()) ?? (await getNaraProvider());
  if (currentName === 'OpenRouter')  return (await getGeminiProvider()) ?? (await getNaraProvider());
  if (currentName === 'NaraRouter')  return (await getOpenRouterProvider()) ?? (await getGeminiProvider());
  return null;
}

// ── Model management ────────────────────────────────────────────────────────

export type AIModelId = string;
export type AIModel = { id: string; label: string; description: string; };

/** 
 * Returns ALL models from ALL providers that COULD be configured.
 * Uses env var check (sync) for model listing — actual key resolution
 * happens async at runtime in interpretTelegramMessage().
 */
export function getAvailableModels(): AIModel[] {
  return getModels();
}

export function getModels(): AIModel[] {
  // For model listing we check env vars + assume DB keys may exist.
  // OpenRouter models are shown if OPENROUTER_API_KEY is set (env or DB).
  // Show both provider models if either source has a key configured.
  // The actual key resolution (DB vs env) happens async at runtime.
  const models: AIModel[] = [];
  // Always show both providers' models — the user can configure keys from the UI
  models.push(...GEMINI_MODELS);
  models.push(...NARA_MODELS);
  return models;
}

export const AVAILABLE_MODELS = {
  get length() { return getModels().length; },
  find(fn: (m: AIModel) => boolean) { return getModels().find(fn); },
  map<T>(fn: (m: AIModel) => T) { return getModels().map(fn); },
  some(fn: (m: AIModel) => boolean) { return getModels().some(fn); },
  filter(fn: (m: AIModel) => boolean) { return getModels().filter(fn); },
  forEach(fn: (m: AIModel) => void) { getModels().forEach(fn); },
  [Symbol.iterator]() { return getModels()[Symbol.iterator](); },
};

export type GeminiModelId = AIModelId;
export type GeminiModel = AIModel;

function modelKey(userId: string) { return `ai:model:${userId}`; }

export async function getUserModel(userId: string): Promise<string> {
  const allModels = getModels();
  try {
    const stored = await getRedisClient().get<string>(modelKey(userId));
    if (stored && allModels.some(m => m.id === stored)) return stored;
  } catch { /* Redis unavailable */ }
  // Default: first available provider's default model
  const provider = await resolveProvider();
  return provider?.defaultModel ?? 'gemini-3.5-flash';
}

export async function setUserModel(userId: string, modelId: string): Promise<void> {
  await getRedisClient().set(modelKey(userId), modelId, { ex: 60 * 60 * 24 * 30 });
}

// ── Config ─────────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 3;

// ── System Prompt ────────────────────────────────────────────────────────────

// SYSTEM_PROMPT is built dynamically: base instructions + live knowledge base
const BASE_SYSTEM_PROMPT = `You are AutoMint AI — a smart assistant with full control over the AutoMint NFT platform. You run on the website and Telegram.

## WHO YOU ARE
You can answer questions, explain features, and execute actions. Think ChatGPT but specialized for AutoMint.

## PLATFORM
AutoMint is an NFT minting intelligence platform:
• Wallets — EVM wallets on Ethereum/Base/Polygon/Arbitrum
• Analyzer — paste URL/contract for risk score, ABI, mint function
• Minting — queue mints, monitor status, retry failures
• Whale Tracker — watch wallets, copy-mint rules to auto-mirror
• Collections — track NFT collections with floor prices
• Analytics — success rates, gas spent, history
• Settings — gas strategy, risk threshold, notifications, AI keys

## AI MODELS
Powered by the user's configured provider: Gemini (Google), Nara (Mistral), or OpenRouter (free/paid models). Change via /model in Telegram.

## RULES
• USD→ETH: 1 ETH ≈ $2500
• Gas strategies: slow/normal/fast/aggressive
• Risk threshold: 0-100 (default 75 blocks high-risk)
• Validate wallet addresses (0x + 40 hex chars)
• For ACTION requests (mint, watch, check, update, cancel) — ALWAYS call the appropriate tool
• For QUESTIONS or CONVERSATION — respond directly, no tool calls
• After tool execution — summarize what happened in plain language
• Diagnose failures: ALWAYS call diagnose_mint_failure first
• Multi-step: break down and call ALL needed tools in sequence
• Be conversational, warm, concise — like a knowledgeable friend
• Use **bold** for key terms, bullet lists for steps
• NEVER start with a long introduction about yourself or list your capabilities. Users already know what you do.
• When greeted ("hi", "hello", "hey", etc.) reply with a SHORT 1-2 sentence response like "Hey! What would you like to do?" — do NOT list features or capabilities.
• On Telegram: keep replies short and scannable. No walls of text. Use short sentences, not paragraphs.`;


// ── Action command detector ───────────────────────────────────────────────────
// These messages clearly map to tool calls and don't need the full knowledge
// base. Skipping it saves ~3000 tokens and ~4-6 seconds of latency per call.
const ACTION_PATTERNS = [
  /^(list|show|get|check|what(?:'s| is| are) (?:my|the))/i,
  /^(mint|cancel|retry|watch|remove|add|update|refresh|set|enable|disable)/i,
  /^(how much|how many|what'?s? my|my wallets?|my mints?|my balance)/i,
  /^\/(mint|watch|status|cancel|settings?|model|schedule|start|help)/i,
  /^https?:\/\//i,
  /^0x[0-9a-fA-F]{40}/i,
];

function isActionCommand(message: string): boolean {
  const m = message.trim();
  return ACTION_PATTERNS.some(p => p.test(m));
}

// Compact summary injected for conversational messages (much smaller than full guide)
const COMPACT_KNOWLEDGE = `
## Quick Reference
- Wallets: Ethereum/Base/Polygon/Arbitrum EVM wallets, check balances, set default
- Minting: paste URL → analyze → mint. Statuses: pending/monitoring/running/completed/failed
- Analyzer: paste URL or contract → risk score (0-100), ABI, mint function, price
- Whale Tracker: watch wallets, copy-mint rules (auto-mirror whale mints)
- Copy-mint fields: walletAddress, maxPrice (ETH), quantity, minMintCount, autoMint, riskThreshold
- Gas strategies: slow/normal/fast/aggressive. Risk threshold: 0-100 (default 75 blocks high-risk)
- Settings: execution (gas/risk), notifications (Telegram/email), AI keys (Gemini/Nara/OpenRouter)
- Telegram link: Settings → Notifications → Telegram → Generate Token → /start <token>
- Free fast models: meta-llama/llama-3.1-8b-instruct:free via OpenRouter (~1-3s)
- USD→ETH: 1 ETH ≈ $2500 (e.g. $10 = 0.004 ETH)
`;

function buildSystemPrompt(message: string): string {
  // For action commands: lean prompt, no knowledge base = fastest response
  if (isActionCommand(message)) {
    return BASE_SYSTEM_PROMPT;
  }
  // For conversational/question messages: add compact knowledge summary
  // (not the full guide — that adds 4+ seconds for zero benefit on most queries)
  return BASE_SYSTEM_PROMPT + COMPACT_KNOWLEDGE;
}

// ── Tool Declarations (OpenAI format) ────────────────────────────────────────

const TOOLS: ChatCompletionTool[] = [
  // ─── Wallet & Balance ───
  { type: 'function', function: { name: 'get_wallets', description: "List all of the user's wallets with addresses, chains, and balances.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_wallet_balance', description: "Check the ETH balance of the user's wallet on a specific chain.", parameters: { type: 'object', properties: { chain: { type: 'string', description: 'Chain: ethereum, base, polygon, or arbitrum. Default: ethereum' } } } } },

  // ─── Whale Tracking ───
  { type: 'function', function: { name: 'watch_wallet', description: 'Add a wallet address to the whale tracker. Monitors on-chain activity via Alchemy webhooks.', parameters: { type: 'object', properties: { walletAddress: { type: 'string', description: 'EVM wallet address (0x...)' }, chain: { type: 'string', description: 'Chain: ethereum, base, polygon, or arbitrum. Default: ethereum' }, walletName: { type: 'string', description: 'Optional friendly label' } }, required: ['walletAddress'] } } },
  { type: 'function', function: { name: 'get_watched_wallets', description: 'List all currently watched wallets and their status.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'remove_watched_wallet', description: 'Remove a wallet from the whale tracker by its ID.', parameters: { type: 'object', properties: { walletId: { type: 'string', description: 'The watched wallet ID (UUID) to remove' } }, required: ['walletId'] } } },
  { type: 'function', function: { name: 'get_whale_activity', description: 'Get recent activity from tracked whale wallets — mints, purchases, transfers.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results to return (default: 20)' } } } } },

  // ─── Copy-Mint Rules ───
  { type: 'function', function: { name: 'create_copy_mint_rule', description: 'Create or update a copy-mint rule for a watched wallet. When the wallet mints NFTs matching conditions, AutoMint auto-mints for the user.', parameters: { type: 'object', properties: { walletAddress: { type: 'string', description: 'The watched wallet address (0x...)' }, maxPrice: { type: 'string', description: 'Max mint price in ETH (e.g. "0.002"). Omit for no limit.' }, quantity: { type: 'number', description: 'NFTs to mint when triggered (default: 1)' }, minMintCount: { type: 'number', description: 'Min whale mints before triggering (default: 1)' }, autoMint: { type: 'boolean', description: 'true = mint automatically, false = notify only' }, riskThreshold: { type: 'number', description: 'Max risk score 0-100 (default: 75)' } }, required: ['walletAddress'] } } },
  { type: 'function', function: { name: 'get_copy_mint_rules', description: 'List all active copy-mint rules.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'delete_copy_mint_rule', description: 'Delete a copy-mint rule by its ID.', parameters: { type: 'object', properties: { ruleId: { type: 'string', description: 'The copy-mint rule ID (UUID) to delete' } }, required: ['ruleId'] } } },

  // ─── Minting ───
  { type: 'function', function: { name: 'mint_from_url', description: 'Create an instant mint task from a collection URL (OpenSea, Etherscan, or any mint page).', parameters: { type: 'object', properties: { url: { type: 'string', description: 'The mint page URL' }, quantity: { type: 'number', description: 'Number of NFTs to mint (default: 1)' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'get_active_mints', description: 'Get the status of active/pending mint tasks.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'cancel_mint', description: 'Cancel a pending or scheduled mint task by its task ID.', parameters: { type: 'object', properties: { taskId: { type: 'string', description: 'The mint task ID to cancel' } }, required: ['taskId'] } } },
  { type: 'function', function: { name: 'retry_failed_mint', description: 'Retry a failed mint task. Creates a new mint task for the same contract.', parameters: { type: 'object', properties: { taskId: { type: 'string', description: 'The failed mint task ID to retry' } }, required: ['taskId'] } } },
  { type: 'function', function: { name: 'diagnose_mint_failure', description: 'Diagnose why a mint failed. Returns the task with full execution log timeline, error reason, wallet balance, and mint cost. ALWAYS call this when user asks why a mint failed.', parameters: { type: 'object', properties: { contractAddress: { type: 'string', description: 'Optional contract address (0x...) to diagnose a specific collection' } } } } },

  // ─── Analyzer ───
  { type: 'function', function: { name: 'analyze_contract', description: 'Run the full contract analyzer on a URL or contract address. Returns risk score, ABI, mint function, social links, on-chain data.', parameters: { type: 'object', properties: { input: { type: 'string', description: 'URL (mint page, OpenSea, Etherscan) or contract address (0x...)' }, chain: { type: 'string', description: 'Chain for contract addresses: ethereum, base, polygon, arbitrum. Default: ethereum' } }, required: ['input'] } } },

  // ─── Analytics & History ───
  { type: 'function', function: { name: 'get_analytics', description: 'Get analytics summary: total mints, success rate, total gas spent, recent trends.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_mint_history', description: 'Get past mint history with results, gas costs, and timestamps.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default: 20)' }, status: { type: 'string', description: 'Filter by status: completed, confirmed, failed, cancelled. Omit for all.' } } } } },
  { type: 'function', function: { name: 'get_mint_logs', description: 'Get detailed execution logs for a specific mint task.', parameters: { type: 'object', properties: { taskId: { type: 'string', description: 'The mint task ID' } }, required: ['taskId'] } } },

  // ─── Collections ───
  { type: 'function', function: { name: 'get_collections', description: 'List tracked NFT collections with names, contract addresses, and floor prices.', parameters: { type: 'object', properties: {} } } },

  // ─── Discovery ───
  { type: 'function', function: { name: 'discover_collection', description: 'Look up an NFT collection on OpenSea by URL. Returns metadata, floor price, and mint info.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'OpenSea collection URL' } }, required: ['url'] } } },

  // ─── Settings ───
  { type: 'function', function: { name: 'get_execution_settings', description: "Get the user's current execution settings: gas strategy, risk analysis toggle, safe mode, price limits.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'update_execution_settings', description: 'Update execution settings. Only pass the fields you want to change.', parameters: { type: 'object', properties: { gasStrategy: { type: 'string', description: 'Gas strategy: slow, normal, fast, or aggressive' }, riskAnalysisEnabled: { type: 'boolean', description: 'Enable/disable risk analysis before mints' }, safeModeEnabled: { type: 'boolean', description: 'Block high-risk mints automatically' }, maxGasPriceGwei: { type: 'number', description: 'Maximum gas price in Gwei' }, maxMintPriceEth: { type: 'string', description: 'Maximum mint price in ETH' } } } } },
  { type: 'function', function: { name: 'get_notification_settings', description: "Get user's notification settings for email and Telegram alerts.", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'update_notification_settings', description: 'Update notification preferences.', parameters: { type: 'object', properties: { emailEnabled: { type: 'boolean', description: 'Enable email notifications' }, telegramEnabled: { type: 'boolean', description: 'Enable Telegram notifications' }, notifyOnMintSuccess: { type: 'boolean', description: 'Alert on successful mints' }, notifyOnMintFailure: { type: 'boolean', description: 'Alert on failed mints' }, notifyOnWhaleActivity: { type: 'boolean', description: 'Alert on whale activity' } } } } },

  // ─── System ───
  { type: 'function', function: { name: 'get_system_status', description: 'Get system health: database, Redis, RPC providers, QStash, and service status.', parameters: { type: 'object', properties: {} } } },

  // ─── Search ───
  { type: 'function', function: { name: 'search_data', description: 'Search across all data: mints, collections, wallets, activities.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } } },
  // ─── Activities ───
  { type: 'function', function: { name: 'get_activities', description: 'Get recent activity feed — wallet additions, mint status changes, collection events.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default: 20)' } } } } },

  // ─── Analyzer History ───
  { type: 'function', function: { name: 'get_analyzer_history', description: 'Get past contract analysis results with risk scores and collection data.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default: 20)' } } } } },

  // ─── Monitoring ───
  { type: 'function', function: { name: 'get_monitoring_websites', description: 'List all monitored mint page websites.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'add_monitoring_website', description: 'Add a mint page URL to the website monitor. Tracks changes to the page.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'The mint page URL to monitor' }, name: { type: 'string', description: 'Friendly name for this monitor' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'remove_monitoring_website', description: 'Remove a monitored website by its ID.', parameters: { type: 'object', properties: { websiteId: { type: 'string', description: 'Website monitor ID to remove' } }, required: ['websiteId'] } } },
  { type: 'function', function: { name: 'get_monitoring_events', description: 'Get recent monitoring events — page changes, status updates.', parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max results (default: 20)' } } } } },

  // ─── Blockchain ───
  { type: 'function', function: { name: 'get_gas_estimate', description: 'Get current gas price estimates for a chain.', parameters: { type: 'object', properties: { chain: { type: 'string', description: 'Chain: ethereum, base, polygon, arbitrum. Default: ethereum' } } } } },
  { type: 'function', function: { name: 'check_mint_status_onchain', description: 'Check on-chain mint status for a contract — total supply, minted count, price, phase.', parameters: { type: 'object', properties: { contractAddress: { type: 'string', description: 'Contract address (0x...)' }, chain: { type: 'string', description: 'Chain. Default: ethereum' } }, required: ['contractAddress'] } } },

  // ─── Collection Management ───
  { type: 'function', function: { name: 'refresh_collection_floor', description: 'Refresh the floor price for a tracked collection.', parameters: { type: 'object', properties: { collectionId: { type: 'string', description: 'Collection ID to refresh' } }, required: ['collectionId'] } } },
  { type: 'function', function: { name: 'remove_collection', description: 'Remove a tracked collection.', parameters: { type: 'object', properties: { collectionId: { type: 'string', description: 'Collection ID to remove' } }, required: ['collectionId'] } } },

  // ─── Wallet Management ───
  { type: 'function', function: { name: 'update_wallet', description: 'Update a wallet nickname.', parameters: { type: 'object', properties: { walletId: { type: 'string', description: 'Wallet ID' }, nickname: { type: 'string', description: 'New nickname for the wallet' } }, required: ['walletId'] } } },
  { type: 'function', function: { name: 'remove_wallet', description: 'Delete a wallet from the account. This is permanent.', parameters: { type: 'object', properties: { walletId: { type: 'string', description: 'Wallet ID to delete' } }, required: ['walletId'] } } },
  { type: 'function', function: { name: 'set_default_wallet', description: 'Set a wallet as the default for minting.', parameters: { type: 'object', properties: { walletId: { type: 'string', description: 'Wallet ID to set as default' } }, required: ['walletId'] } } },
  { type: 'function', function: { name: 'refresh_wallet_balance', description: 'Refresh the on-chain balance for a wallet.', parameters: { type: 'object', properties: { walletId: { type: 'string', description: 'Wallet ID to refresh' } }, required: ['walletId'] } } },

  // ─── Email Settings ───
  { type: 'function', function: { name: 'get_email_settings', description: 'Get email notification preferences — which events trigger emails.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'update_email_settings', description: 'Update email notification preferences.', parameters: { type: 'object', properties: { mintScheduled: { type: 'boolean' }, mintSuccess: { type: 'boolean' }, mintFailed: { type: 'boolean' }, systemErrors: { type: 'boolean' } } } } },

  // ─── Integrations & Usage ───
  { type: 'function', function: { name: 'get_integrations_status', description: 'Check the status of all configured integrations — Alchemy, Firecrawl, QStash, Redis, Clerk, etc.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_usage', description: 'Get usage summary — configured services and their status.', parameters: { type: 'object', properties: {} } } },

  // ─── Account ───
  { type: 'function', function: { name: 'reset_all_data', description: 'DESTRUCTIVE: Delete ALL user data — wallets, mints, collections, settings. Cannot be undone. Use with extreme caution.', parameters: { type: 'object', properties: { confirm: { type: 'boolean', description: 'Must be true to proceed. Always ask the user to confirm first.' } }, required: ['confirm'] } } },

  // ─── WL Tracker ───
  { type: 'function', function: { name: 'wl_list_projects', description: "List all of the user's tracked whitelist / allowlist projects (Twitter accounts we're watching for winner announcements, mint links, or delays).", parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'wl_track_project', description: 'Start tracking a Twitter account for WL-related announcements. Resolves the profile once and only surfaces tweets posted AFTER tracking starts.', parameters: { type: 'object', properties: { handle: { type: 'string', description: 'Twitter handle: @foo, foo, twitter.com/foo, or full URL — any format works.' }, walletUsed: { type: 'string', description: "Optional: the EVM wallet the user applied to the WL with (0x…)." }, notes: { type: 'string', description: 'Optional free-form note ("did RT + follow + comment").' }, formType: { type: 'string', description: 'Optional platform: premint | alphabot | atlas3 | superful | gleam | google_form | twitter_form | discord | other.' }, hasDailyCheckin: { type: 'boolean', description: 'True if this project requires a daily check-in.' }, dailyCheckinUrl: { type: 'string', description: 'Optional URL the user visits daily to complete the check-in.' } }, required: ['handle'] } } },
  { type: 'function', function: { name: 'wl_untrack_project', description: 'Stop tracking a project. Accepts a fuzzy handle ("pudgy") or the exact @handle.', parameters: { type: 'object', properties: { handle: { type: 'string', description: 'Twitter handle or fuzzy project name.' } }, required: ['handle'] } } },
  { type: 'function', function: { name: 'wl_list_recent_tweets', description: 'List the most recent classified tweets across tracked projects (winners announcements, mint links, delays). Filter by projectId or urgency.', parameters: { type: 'object', properties: { projectId: { type: 'string', description: 'Optional project UUID to filter to one project.' }, urgencyMin: { type: 'string', description: "Optional minimum urgency: 'critical' | 'high' | 'medium' | 'low'. Defaults to 'low' (all)." }, limit: { type: 'number', description: 'Max rows to return (default 20, max 100).' } } } } },

  // ─── WL Daily Check-in ───
  { type: 'function', function: { name: 'wl_todays_checkins', description: "List projects that still have a pending daily check-in for today (in the user's local timezone). Use this whenever the user asks 'what are my check-ins today?'.", parameters: { type: 'object', properties: { timezone: { type: 'string', description: "IANA timezone name (e.g. 'Asia/Calcutta'). Defaults to UTC." } } } } },
  { type: 'function', function: { name: 'wl_mark_checkin_done', description: 'Log a daily check-in as completed for one project. Advances the streak.', parameters: { type: 'object', properties: { handle: { type: 'string', description: 'Twitter handle or fuzzy project name.' }, notes: { type: 'string', description: 'Optional free-form note.' } }, required: ['handle'] } } },
  { type: 'function', function: { name: 'wl_enable_checkin', description: 'Turn on daily-check-in reminders for an already-tracked project.', parameters: { type: 'object', properties: { handle: { type: 'string' }, url: { type: 'string', description: 'Optional check-in URL.' }, timeHint: { type: 'string', description: 'Optional time hint ("morning", "18:00 UTC").' } }, required: ['handle'] } } },
  { type: 'function', function: { name: 'wl_disable_checkin', description: 'Turn off daily-check-in reminders for a project.', parameters: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] } } },
  { type: 'function', function: { name: 'wl_get_checkin_streak', description: 'Get the current consecutive-days streak for one project.', parameters: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] } } },

];

// ── Tool Executor ────────────────────────────────────────────────────────────

// ── Tool → Event mapping ────────────────────────────────────────────────────
// Maps mutating tool names to event-bus event types. Read-only tools are
// omitted — they don't need to trigger browser invalidation.
const TOOL_EVENT_MAP: Record<string, EventType> = {
  watch_wallet:                'watched-wallet:created',
  remove_watched_wallet:       'watched-wallet:removed',
  create_copy_mint_rule:       'copy-rule:created',
  delete_copy_mint_rule:       'copy-rule:deleted',
  mint_from_url:               'mint:created',
  cancel_mint:                 'mint:cancelled',
  retry_failed_mint:           'mint:retried',
  analyze_contract:            'analyzer:completed',
  discover_collection:         'collection:discovered',
  refresh_collection_floor:    'collection:floor-refreshed',
  remove_collection:           'collection:removed',
  update_wallet:               'wallet:updated',
  remove_wallet:               'wallet:removed',
  set_default_wallet:          'wallet:updated',
  refresh_wallet_balance:      'wallet:balance',
  update_execution_settings:   'settings:updated',
  update_notification_settings:'settings:updated',
  update_email_settings:       'settings:updated',
  add_monitoring_website:      'monitoring:website-added',
  remove_monitoring_website:   'monitoring:website-removed',
  reset_all_data:              'data:reset',
};

async function executeTool(
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (toolName) {
    // ─── Wallet & Balance ───
    case 'get_wallets': {
      const { getDb } = await import('@/lib/db');
      const { wallets } = await import('@/drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const rows = await getDb()
        .select({ id: wallets.id, address: wallets.address, chain: wallets.chain, balance: wallets.balance, balanceSymbol: wallets.balanceSymbol, isDefault: wallets.isDefault })
        .from(wallets)
        .where(eq(wallets.userId, userId));
      return { wallets: rows, count: rows.length };
    }

    case 'get_wallet_balance': {
      const { getDb } = await import('@/lib/db');
      const { wallets } = await import('@/drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const chain = String(input.chain ?? 'ethereum') as 'ethereum' | 'base' | 'polygon' | 'arbitrum';
      const [wallet] = await getDb()
        .select({ address: wallets.address, balance: wallets.balance, balanceSymbol: wallets.balanceSymbol, chain: wallets.chain })
        .from(wallets)
        .where(and(eq(wallets.userId, userId), eq(wallets.chain, chain)))
        .limit(1);
      if (!wallet) return { error: `No wallet found on ${chain}` };
      return { address: wallet.address, balance: wallet.balance, symbol: wallet.balanceSymbol, chain: wallet.chain };
    }

    // ─── Whale Tracking ───
    case 'watch_wallet': {
      const { watchWallet } = await import('@/lib/services/wallet-tracker.service');
      const result = await watchWallet(userId, {
        walletAddress: String(input.walletAddress),
        chain: String(input.chain ?? 'ethereum'),
        walletName: input.walletName ? String(input.walletName) : null,
      });
      return { success: true, ...result };
    }

    case 'get_watched_wallets': {
      const { getUserWatchedWallets } = await import('@/lib/services/wallet-tracker.service');
      const walletsList = await getUserWatchedWallets(userId);
      return { wallets: walletsList, count: walletsList.length };
    }

    case 'remove_watched_wallet': {
      const { getDb } = await import('@/lib/db');
      const { watchedWallets } = await import('@/drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const [deleted] = await getDb()
        .delete(watchedWallets)
        .where(and(eq(watchedWallets.id, String(input.walletId)), eq(watchedWallets.userId, userId)))
        .returning({ id: watchedWallets.id });
      if (!deleted) return { success: false, error: 'Watched wallet not found or not yours' };
      return { success: true, deletedId: deleted.id };
    }

    case 'get_whale_activity': {
      const { getDb } = await import('@/lib/db');
      const { activities } = await import('@/drizzle/schema');
      const { eq, desc } = await import('drizzle-orm');
      const limit = Number(input.limit ?? 20);
      const rows = await getDb()
        .select()
        .from(activities)
        .where(eq(activities.userId, userId))
        .orderBy(desc(activities.createdAt))
        .limit(Math.min(limit, 50));
      return { activities: rows, count: rows.length };
    }

    // ─── Copy-Mint Rules ───
    case 'create_copy_mint_rule': {
      const { upsertCopyMintRule } = await import('@/lib/services/copy-mint.service');
      const result = await upsertCopyMintRule(userId, {
        walletAddress: String(input.walletAddress),
        maxPrice: input.maxPrice !== undefined ? String(input.maxPrice) : null,
        quantity: input.quantity !== undefined ? Number(input.quantity) : 1,
        minMintCount: input.minMintCount !== undefined ? Number(input.minMintCount) : 1,
        autoMint: input.autoMint !== undefined ? Boolean(input.autoMint) : false,
        riskThreshold: input.riskThreshold !== undefined ? Number(input.riskThreshold) : undefined,
      });
      return { success: true, ruleId: result.id, walletAddress: result.walletAddress };
    }

    case 'get_copy_mint_rules': {
      const { getCopyMintRules } = await import('@/lib/services/copy-mint.service');
      const rules = await getCopyMintRules(userId);
      return { rules, count: rules.length };
    }

    case 'delete_copy_mint_rule': {
      const { deleteCopyMintRule } = await import('@/lib/services/copy-mint.service');
      await deleteCopyMintRule(userId, String(input.ruleId));
      return { success: true, deletedRuleId: String(input.ruleId) };
    }

    // ─── Minting ───
    case 'mint_from_url': {
      const { createMintTaskFromUrl } = await import('@/lib/services/mint-orchestrator.service');
      const { getDb: getDb2 } = await import('@/lib/db');
      const { wallets: walletsTable } = await import('@/drizzle/schema');
      const { eq: eq2, and: and2 } = await import('drizzle-orm');
      // Prefer the user's default wallet; fall back to any wallet.
      let [defaultWallet] = await getDb2()
        .select({ id: walletsTable.id })
        .from(walletsTable)
        .where(and2(eq2(walletsTable.userId, userId), eq2(walletsTable.isDefault, true)))
        .limit(1);
      if (!defaultWallet) {
        [defaultWallet] = await getDb2()
          .select({ id: walletsTable.id })
          .from(walletsTable)
          .where(eq2(walletsTable.userId, userId))
          .limit(1);
      }
      if (!defaultWallet) return { error: 'No wallet configured. Add a wallet first.' };
      const result = await createMintTaskFromUrl(String(input.url), defaultWallet.id, userId, input.quantity ? Number(input.quantity) : 1);
      return { success: true, action: result.action, taskId: result.taskId, error: result.error };
    }

    case 'get_active_mints': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks } = await import('@/drizzle/schema');
      const { and, eq, inArray, desc } = await import('drizzle-orm');
      const tasks = await getDb()
        .select({ id: mintTasks.id, status: mintTasks.status, contractAddress: mintTasks.contractAddress, quantity: mintTasks.quantity, mintPrice: mintTasks.mintPrice, createdAt: mintTasks.createdAt, scheduledTime: mintTasks.scheduledTime })
        .from(mintTasks)
        .where(and(eq(mintTasks.userId, userId), inArray(mintTasks.status, ['pending', 'monitoring', 'ready', 'running'])))
        .orderBy(desc(mintTasks.createdAt))
        .limit(10);
      return { tasks, count: tasks.length };
    }

    case 'cancel_mint': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks } = await import('@/drizzle/schema');
      const { and, eq, inArray } = await import('drizzle-orm');
      const [updated] = await getDb()
        .update(mintTasks)
        .set({ status: 'cancelled' })
        .where(and(eq(mintTasks.id, String(input.taskId)), eq(mintTasks.userId, userId), inArray(mintTasks.status, ['pending', 'monitoring', 'ready'])))
        .returning({ id: mintTasks.id });
      if (!updated) return { success: false, error: 'Task not found or not cancellable' };
      return { success: true, cancelledTaskId: updated.id };
    }

    case 'retry_failed_mint': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks } = await import('@/drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      // Find the failed task
      const [failedTask] = await getDb()
        .select({ id: mintTasks.id, contractAddress: mintTasks.contractAddress, quantity: mintTasks.quantity, walletId: mintTasks.walletId, mintPrice: mintTasks.mintPrice, status: mintTasks.status })
        .from(mintTasks)
        .where(and(eq(mintTasks.id, String(input.taskId)), eq(mintTasks.userId, userId)))
        .limit(1);
      if (!failedTask) return { error: 'Task not found' };
      if (failedTask.status !== 'failed' && failedTask.status !== 'cancelled') return { error: `Task is ${failedTask.status}, not failed. Can only retry failed tasks.` };
      // Reset the task to pending for re-execution
      const [retried] = await getDb()
        .update(mintTasks)
        .set({ status: 'pending' })
        .where(eq(mintTasks.id, failedTask.id))
        .returning({ id: mintTasks.id, contractAddress: mintTasks.contractAddress });
      // Queue it for execution
      const { scheduleMint } = await import('@/lib/services/qstash.service');
      await scheduleMint({ taskId: failedTask.id, userId });
      return { success: true, retriedTaskId: retried.id, contractAddress: retried.contractAddress };
    }

    case 'diagnose_mint_failure': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, taskLogs, wallets } = await import('@/drizzle/schema');
      const { and, eq, desc } = await import('drizzle-orm');
      const contract = input.contractAddress ? String(input.contractAddress).toLowerCase() : null;
      const conditions = contract
        ? and(eq(mintTasks.userId, userId), eq(mintTasks.contractAddress, contract))
        : eq(mintTasks.userId, userId);
      const [task] = await getDb().select().from(mintTasks).where(conditions).orderBy(desc(mintTasks.createdAt)).limit(1);
      if (!task) return { found: false, message: 'No mint tasks found to diagnose.' };
      const logs = await getDb()
        .select({ event: taskLogs.event, status: taskLogs.status, message: taskLogs.message, createdAt: taskLogs.createdAt })
        .from(taskLogs).where(eq(taskLogs.taskId, task.id)).orderBy(desc(taskLogs.createdAt)).limit(25);
      let walletAddress: string | null = null;
      let walletBalance: string | null = null;
      let mintCost: string | null = null;
      if (task.walletId) {
        const [w] = await getDb().select().from(wallets).where(eq(wallets.id, task.walletId)).limit(1);
        if (w) {
          walletAddress = w.address;
          try {
            const { getWalletBalance } = await import('@/lib/blockchain/wallet');
            const { getNativeTokenUsdPrice, formatWithUsd } = await import('@/lib/services/native-price.service');
            const [bal, usdPrice] = await Promise.all([getWalletBalance(w.address, w.chain), getNativeTokenUsdPrice(w.chain).catch(() => 0)]);
            walletBalance = usdPrice ? formatWithUsd(bal.balance, bal.symbol, usdPrice) : `${bal.balance} ${bal.symbol}`;
            if (task.mintPrice) { const costEth = Number(task.mintPrice) * task.quantity; mintCost = usdPrice ? formatWithUsd(costEth, bal.symbol, usdPrice) : `${costEth} ${bal.symbol}`; }
          } catch { /* best-effort */ }
        }
      }
      const errorLog = logs.find((l) => l.status === 'error');
      return { found: true, task: { id: task.id, status: task.status, contractAddress: task.contractAddress, mintPrice: task.mintPrice, quantity: task.quantity, phase: task.phase, txHash: task.txHash, createdAt: task.createdAt }, failureReason: errorLog?.message ?? null, walletAddress, walletBalance, mintCost, logs: logs.reverse() };
    }

    // ─── Analyzer ───
    case 'analyze_contract': {
      const { runAnalyzer } = await import('@/lib/services/analyzer.service');
      const rawInput = String(input.input);
      const result = await runAnalyzer({ userId, input: rawInput });
      // Return a condensed summary for the AI
      return {
        success: true,
        name: result.metadata?.name,
        contractAddress: result.intent?.contractAddress,
        chain: result.intent?.chain,
        mintState: result.mintState,
        mintFunction: result.mintFunction?.functionName,
        totalSupply: result.metadata?.totalSupply,
        riskScore: result.riskAnalysis?.riskScore,
        riskLevel: result.riskAnalysis?.riskLevel,
        riskFactors: result.riskAnalysis?.riskFactors,
        socials: result.socials,
        providerUsed: result.providerUsed,
        analysisDurationMs: result.analysisDurationMs,
      };
    }

    // ─── Analytics & History ───
    case 'get_analytics': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, mintHistory } = await import('@/drizzle/schema');
      const { eq, count, and, sql } = await import('drizzle-orm');
      // Total tasks
      const [totalResult] = await getDb().select({ count: count() }).from(mintTasks).where(eq(mintTasks.userId, userId));
      // Successful (confirmed)
      const [confirmedResult] = await getDb().select({ count: count() }).from(mintTasks).where(and(eq(mintTasks.userId, userId), eq(mintTasks.status, 'completed')));
      // Failed
      const [failedResult] = await getDb().select({ count: count() }).from(mintTasks).where(and(eq(mintTasks.userId, userId), eq(mintTasks.status, 'failed')));
      // Gas spent (from mint history)
      const [gasResult] = await getDb().select({ totalGas: sql<string>`COALESCE(SUM(CAST(gas_used AS NUMERIC)), 0)` }).from(mintHistory).where(eq(mintHistory.userId, userId));
      const total = totalResult?.count ?? 0;
      const completed = confirmedResult?.count ?? 0;
      const failed = failedResult?.count ?? 0;
      const successRate = total > 0 ? ((completed / total) * 100).toFixed(1) + '%' : '0%';
      return { totalMints: total, completed, failed, cancelled: total - completed - failed, successRate, totalGasUsed: gasResult?.totalGas ?? '0' };
    }

    case 'get_mint_history': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, collections } = await import('@/drizzle/schema');
      const { eq, desc, and } = await import('drizzle-orm');
      const limit = Math.min(Number(input.limit ?? 20), 50);
      const statusFilter = input.status ? String(input.status) as 'pending' | 'monitoring' | 'ready' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unconfirmed' : null;
      const conditions = statusFilter
        ? and(eq(mintTasks.userId, userId), eq(mintTasks.status, statusFilter))
        : eq(mintTasks.userId, userId);
      const rows = await getDb()
        .select({ id: mintTasks.id, status: mintTasks.status, contractAddress: mintTasks.contractAddress, quantity: mintTasks.quantity, mintPrice: mintTasks.mintPrice, txHash: mintTasks.txHash, createdAt: mintTasks.createdAt, collectionName: collections.name })
        .from(mintTasks)
        .leftJoin(collections, eq(mintTasks.collectionId, collections.id))
        .where(conditions)
        .orderBy(desc(mintTasks.createdAt))
        .limit(limit);
      return { mints: rows, count: rows.length };
    }

    case 'get_mint_logs': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, taskLogs } = await import('@/drizzle/schema');
      const { eq, and, desc } = await import('drizzle-orm');
      // Verify task belongs to user
      const [task] = await getDb().select({ id: mintTasks.id }).from(mintTasks).where(and(eq(mintTasks.id, String(input.taskId)), eq(mintTasks.userId, userId))).limit(1);
      if (!task) return { error: 'Task not found or not yours' };
      const logs = await getDb()
        .select({ event: taskLogs.event, status: taskLogs.status, message: taskLogs.message, createdAt: taskLogs.createdAt })
        .from(taskLogs).where(eq(taskLogs.taskId, task.id)).orderBy(desc(taskLogs.createdAt)).limit(50);
      return { taskId: task.id, logs: logs.reverse(), count: logs.length };
    }

    // ─── Collections ───
    case 'get_collections': {
      const { getDb } = await import('@/lib/db');
      const { collections } = await import('@/drizzle/schema');
      const { eq, desc } = await import('drizzle-orm');
      const rows = await getDb()
        .select({ id: collections.id, name: collections.name, contractAddress: collections.contractAddress, chain: collections.chain, floorPrice: collections.floorPrice, createdAt: collections.createdAt })
        .from(collections)
        .where(eq(collections.userId, userId))
        .orderBy(desc(collections.createdAt))
        .limit(50);
      return { collections: rows, count: rows.length };
    }

    // ─── Discovery ───
    case 'discover_collection': {
      const { discoverCollection } = await import('@/lib/services/discovery.service');
      const result = await discoverCollection(String(input.url));
      return { success: true, ...result };
    }

    // ─── Settings ───
    case 'get_execution_settings': {
      const { getEffectiveExecutionDefaults } = await import('@/lib/services/execution-settings.service');
      const settings = await getEffectiveExecutionDefaults(userId);
      return { ...settings };
    }

    case 'update_execution_settings': {
      const { updateExecutionSettings } = await import('@/lib/services/execution-settings.service');
      const updates: Record<string, unknown> = {};
      if (input.gasStrategy !== undefined) updates.gasStrategy = String(input.gasStrategy);
      if (input.riskAnalysisEnabled !== undefined) updates.riskAnalysisEnabled = Boolean(input.riskAnalysisEnabled);
      if (input.safeModeEnabled !== undefined) updates.safeModeEnabled = Boolean(input.safeModeEnabled);
      if (input.maxGasPriceGwei !== undefined) updates.maxGasPriceGwei = Number(input.maxGasPriceGwei);
      if (input.maxMintPriceEth !== undefined) updates.maxMintPriceEth = String(input.maxMintPriceEth);
      const result = await updateExecutionSettings(userId, updates);
      return { success: true, updated: result };
    }

    case 'get_notification_settings': {
      const { getAllSettings } = await import('@/lib/services/integration-settings.service');
      const settings = await getAllSettings();
      return { ...settings };
    }

    case 'update_notification_settings': {
      const { setSetting } = await import('@/lib/services/integration-settings.service');
      const updated: Record<string, string> = {};
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined) {
          const stringValue = String(value);
          await setSetting(key as Parameters<typeof setSetting>[0], stringValue);
          updated[key] = stringValue;
        }
      }
      return { success: true, updated };
    }

    // ─── System ───
    case 'get_system_status': {
      const { getSystemStatusSnapshot } = await import('@/lib/services/system-status.service');
      const report = await getSystemStatusSnapshot(userId);
      return { ...report };
    }

    // ─── Search ───
    case 'search_data': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, collections, wallets } = await import('@/drizzle/schema');
      const { eq } = await import('drizzle-orm');
      // Search across multiple tables
      const [mintResults, collectionResults, walletResults] = await Promise.all([
        getDb().select({ id: mintTasks.id, type: mintTasks.status, contractAddress: mintTasks.contractAddress, createdAt: mintTasks.createdAt })
          .from(mintTasks).where(eq(mintTasks.userId, userId)).limit(10),
        getDb().select({ id: collections.id, name: collections.name, contractAddress: collections.contractAddress })
          .from(collections).where(eq(collections.userId, userId)).limit(10),
        getDb().select({ id: wallets.id, address: wallets.address, chain: wallets.chain })
          .from(wallets).where(eq(wallets.userId, userId)).limit(10),
      ]);
      // Filter client-side by query (drizzle ilike needs text columns)
      const query = String(input.query).toLowerCase();
      const filteredMints = mintResults.filter(m => m.contractAddress?.toLowerCase().includes(query) || m.type?.toLowerCase().includes(query));
      const filteredCollections = collectionResults.filter(c => c.name?.toLowerCase().includes(query) || c.contractAddress?.toLowerCase().includes(query));
      const filteredWallets = walletResults.filter(w => w.address?.toLowerCase().includes(query) || w.chain?.toLowerCase().includes(query));
      return { mints: filteredMints, collections: filteredCollections, wallets: filteredWallets, totalResults: filteredMints.length + filteredCollections.length + filteredWallets.length };
    }


    // ─── Activities ───
    case 'get_activities': {
      const { getDb } = await import('@/lib/db');
      const { activities } = await import('@/drizzle/schema');
      const { eq, desc } = await import('drizzle-orm');
      const limit = Math.min(Number(input.limit ?? 20), 50);
      const rows = await getDb().select().from(activities).where(eq(activities.userId, userId)).orderBy(desc(activities.createdAt)).limit(limit);
      return { activities: rows, count: rows.length };
    }

    // ─── Analyzer History ───
    case 'get_analyzer_history': {
      const { getDb } = await import('@/lib/db');
      const { analyzerHistory } = await import('@/drizzle/schema');
      const { eq, desc } = await import('drizzle-orm');
      const limit = Math.min(Number(input.limit ?? 20), 50);
      const rows = await getDb()
        .select({ id: analyzerHistory.id, input: analyzerHistory.input, collectionName: analyzerHistory.collectionName, contractAddress: analyzerHistory.contractAddress, chain: analyzerHistory.chain, riskScore: analyzerHistory.riskScore, riskLevel: analyzerHistory.riskLevel, createdAt: analyzerHistory.createdAt })
        .from(analyzerHistory).where(eq(analyzerHistory.userId, userId)).orderBy(desc(analyzerHistory.createdAt)).limit(limit);
      return { history: rows, count: rows.length };
    }

    // ─── Monitoring ───
    case 'get_monitoring_websites': {
      const { getDb } = await import('@/lib/db');
      const { monitoredWebsites } = await import('@/drizzle/schema/monitoring');
      const { eq } = await import('drizzle-orm');
      const rows = await getDb().select().from(monitoredWebsites).where(eq(monitoredWebsites.userId, userId));
      return { websites: rows, count: rows.length };
    }

    case 'add_monitoring_website': {
      const { getDb } = await import('@/lib/db');
      const { monitoredWebsites } = await import('@/drizzle/schema/monitoring');
      const [created] = await getDb().insert(monitoredWebsites).values({ userId, url: String(input.url), name: input.name ? String(input.name) : String(input.url) } as typeof monitoredWebsites.$inferInsert).returning();
      return { success: true, website: created };
    }

    case 'remove_monitoring_website': {
      const { getDb } = await import('@/lib/db');
      const { monitoredWebsites } = await import('@/drizzle/schema/monitoring');
      const { eq, and } = await import('drizzle-orm');
      const [deleted] = await getDb().delete(monitoredWebsites).where(and(eq(monitoredWebsites.id, String(input.websiteId)), eq(monitoredWebsites.userId, userId))).returning({ id: monitoredWebsites.id });
      if (!deleted) return { error: 'Website monitor not found' };
      return { success: true, deletedId: deleted.id };
    }

    case 'get_monitoring_events': {
      const { getDb } = await import('@/lib/db');
      const { monitoringEvents, monitoredWebsites } = await import('@/drizzle/schema/monitoring');
      const { eq, desc, inArray } = await import('drizzle-orm');
      const limit = Math.min(Number(input.limit ?? 20), 50);
      // Get user's website IDs first, then their events
      const userSites = await getDb().select({ id: monitoredWebsites.id }).from(monitoredWebsites).where(eq(monitoredWebsites.userId, userId));
      const siteIds = userSites.map(s => s.id);
      if (siteIds.length === 0) return { events: [], count: 0 };
      const rows = await getDb().select().from(monitoringEvents).where(inArray(monitoringEvents.websiteId, siteIds)).orderBy(desc(monitoringEvents.createdAt)).limit(limit);
      return { events: rows, count: rows.length };
    }

    // ─── Blockchain ───
    case 'get_gas_estimate': {
      const { getClient } = await import('@/lib/blockchain/client');
      const { formatGwei } = await import('viem');
      const chain = String(input.chain ?? 'ethereum') as 'ethereum' | 'base' | 'polygon' | 'arbitrum';
      const client = getClient(chain);
      const gasPrice = await client.getGasPrice();
      return { chain, gasPriceWei: gasPrice.toString(), gasPriceGwei: formatGwei(gasPrice) };
    }

    case 'check_mint_status_onchain': {
      const { getMintState } = await import('@/lib/services/mint-state.service');
      const state = await getMintState(String(input.contractAddress), String(input.chain ?? 'ethereum'));
      return { contractAddress: String(input.contractAddress), chain: String(input.chain ?? 'ethereum'), ...state };
    }

    // ─── Collection Management ───
    case 'refresh_collection_floor': {
      const { syncCollectionFloorPrice } = await import('@/lib/services/collection.service');
      const { getDb } = await import('@/lib/db');
      const { collections } = await import('@/drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const [col] = await getDb().select().from(collections).where(and(eq(collections.id, String(input.collectionId)), eq(collections.userId, userId))).limit(1);
      if (!col) return { error: 'Collection not found' };
      await syncCollectionFloorPrice(col.id, col.contractAddress, col.chain, col.name);
      return { success: true, collectionId: col.id, name: col.name };
    }

    case 'remove_collection': {
      const { removeCollection } = await import('@/lib/services/collection.service');
      await removeCollection(String(input.collectionId), userId);
      return { success: true, removedId: String(input.collectionId) };
    }

    // ─── Wallet Management ───
    case 'update_wallet': {
      const { updateWallet } = await import('@/lib/services/wallet.service');
      const result = await updateWallet(String(input.walletId), userId, { nickname: input.nickname ? String(input.nickname) : null });
      return { success: true, wallet: result };
    }

    case 'remove_wallet': {
      const { removeWallet } = await import('@/lib/services/wallet.service');
      await removeWallet(String(input.walletId), userId);
      return { success: true, removedId: String(input.walletId) };
    }

    case 'set_default_wallet': {
      const { setDefaultWallet } = await import('@/lib/services/wallet.service');
      await setDefaultWallet(String(input.walletId), userId);
      return { success: true, defaultWalletId: String(input.walletId) };
    }

    case 'refresh_wallet_balance': {
      const { refreshWalletBalance } = await import('@/lib/services/wallet.service');
      const result = await refreshWalletBalance(String(input.walletId), userId);
      return { success: true, wallet: result };
    }

    // ─── Email Settings ───
    case 'get_email_settings': {
      const { getEmailNotificationPreferences } = await import('@/lib/services/email-notification.service');
      const prefs = await getEmailNotificationPreferences(userId);
      return { ...prefs };
    }

    case 'update_email_settings': {
      const { updateEmailNotificationPreferences } = await import('@/lib/services/email-notification.service');
      const updates: Record<string, boolean> = {};
      if (input.mintScheduled !== undefined) updates.mintScheduled = Boolean(input.mintScheduled);
      if (input.mintSuccess !== undefined) updates.mintSuccess = Boolean(input.mintSuccess);
      if (input.mintFailed !== undefined) updates.mintFailed = Boolean(input.mintFailed);
      if (input.systemErrors !== undefined) updates.systemErrors = Boolean(input.systemErrors);
      const result = await updateEmailNotificationPreferences(userId, updates as Parameters<typeof updateEmailNotificationPreferences>[1]);
      return { success: true, updated: result };
    }

    // ─── Integrations & Usage ───
    case 'get_integrations_status': {
      // Return which env vars are configured (without values)
      const check = (key: string) => !!process.env[key]?.trim();
      const services = [
        { name: 'Alchemy', configured: check('ALCHEMY_API_KEY') },
        { name: 'Infura', configured: check('INFURA_API_KEY') },
        { name: 'Chainstack', configured: check('CHAINSTACK_API_KEY') },
        { name: 'Firecrawl', configured: check('FIRECRAWL_API_KEY') },
        { name: 'QStash', configured: check('QSTASH_TOKEN') },
        { name: 'Database', configured: check('DATABASE_URL') },
        { name: 'Redis', configured: check('KV_REST_API_URL') },
        { name: 'Clerk', configured: check('CLERK_SECRET_KEY') },
        { name: 'AI Provider', configured: check('GEMINI_API_KEY') || check('NARA_API_KEY') },
      ];
      return { services, configuredCount: services.filter(s => s.configured).length, totalCount: services.length };
    }

    case 'get_usage': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, wallets, collections, watchedWallets } = await import('@/drizzle/schema');
      const { eq, count } = await import('drizzle-orm');
      const [mintCount] = await getDb().select({ count: count() }).from(mintTasks).where(eq(mintTasks.userId, userId));
      const [walletCount] = await getDb().select({ count: count() }).from(wallets).where(eq(wallets.userId, userId));
      const [collectionCount] = await getDb().select({ count: count() }).from(collections).where(eq(collections.userId, userId));
      const [watchedCount] = await getDb().select({ count: count() }).from(watchedWallets).where(eq(watchedWallets.userId, userId));
      return { mints: mintCount?.count ?? 0, wallets: walletCount?.count ?? 0, collections: collectionCount?.count ?? 0, watchedWallets: watchedCount?.count ?? 0 };
    }

    // ─── Account ───
    case 'reset_all_data': {
      if (!input.confirm || input.confirm !== true) {
        return { error: '⚠️ This will DELETE ALL your data permanently. Pass confirm: true to proceed.' };
      }
      const { deleteAccount } = await import('@/lib/services/account-deletion.service');
      const { getDb: getDb3 } = await import('@/lib/db');
      const { users } = await import('@/drizzle/schema');
      const { eq: eq3 } = await import('drizzle-orm');
      const [user] = await getDb3().select({ clerkId: users.clerkId }).from(users).where(eq3(users.id, userId)).limit(1);
      if (!user) return { error: 'User not found' };
      await deleteAccount({ userId, clerkId: user.clerkId });
      return { success: true, message: 'All data has been permanently deleted.' };
    }

    // ─── WL Tracker ─────────────────────────────────────────────────────
    case 'wl_list_projects': {
      const { listTrackedProjects } = await import('@/lib/services/wl-tracker.service');
      const rows = await listTrackedProjects(userId);
      return {
        projects: rows.map((r) => ({
          id: r.id,
          projectName: r.projectName,
          twitterHandle: r.twitterHandle,
          walletUsed: r.walletUsed,
          notes: r.notes,
          hasDailyCheckin: r.hasDailyCheckin,
          isActive: r.isActive,
          lastCheckedAt: r.lastCheckedAt,
        })),
        count: rows.length,
      };
    }

    case 'wl_track_project': {
      const { addTrackedProject } = await import('@/lib/services/wl-tracker.service');
      const { enableDailyCheckin } = await import('@/lib/services/wl-checkin.service');
      try {
        const project = await addTrackedProject(userId, {
          handle: String(input.handle),
          walletUsed: input.walletUsed ? String(input.walletUsed) : null,
          notes: input.notes ? String(input.notes) : null,
          formType: input.formType as never,
        });
        if (input.hasDailyCheckin === true) {
          await enableDailyCheckin(userId, project.id, {
            url: input.dailyCheckinUrl ? String(input.dailyCheckinUrl) : null,
            timeHint: null,
          });
        }
        return {
          success: true,
          project: {
            id: project.id,
            projectName: project.projectName,
            twitterHandle: project.twitterHandle,
          },
        };
      } catch (error) {
        return { error: (error as Error).message };
      }
    }

    case 'wl_untrack_project': {
      const { findProjectByFuzzyHandle } = await import('@/lib/services/wl-checkin.service');
      const { archiveTrackedProject } = await import('@/lib/services/wl-tracker.service');
      const project = await findProjectByFuzzyHandle(userId, String(input.handle));
      if (!project) return { error: `No tracked project matches "${input.handle}"` };
      await archiveTrackedProject(userId, project.id);
      return { success: true, projectName: project.projectName };
    }

    case 'wl_list_recent_tweets': {
      const { listTweetsForUser, listTweetsForProject } = await import('@/lib/services/wl-tracker.service');
      const limit = Math.min(Number(input.limit ?? 20), 100);
      const rows = input.projectId
        ? await listTweetsForProject(userId, String(input.projectId), limit)
        : await listTweetsForUser(userId, { limit });
      // Apply urgency floor client-side (list function doesn't filter urgency yet).
      const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
      const floor = order[input.urgencyMin as keyof typeof order] ?? order.low;
      const filtered = rows.filter((t) => (order[t.urgency as keyof typeof order] ?? 3) <= floor);
      return {
        tweets: filtered.map((t) => ({
          id: t.id, projectId: t.projectId, category: t.category, urgency: t.urgency,
          summary: t.aiSummary, mintUrl: t.extractedMintUrl, tweetUrl: t.tweetUrl,
          postedAt: t.postedAt, walletMatched: t.walletMatched,
        })),
      };
    }

    // ─── WL Daily Check-in ──────────────────────────────────────────────
    case 'wl_todays_checkins': {
      const { listPendingCheckins } = await import('@/lib/services/wl-checkin.service');
      const tz = typeof input.timezone === 'string' && input.timezone ? input.timezone : 'UTC';
      const pending = await listPendingCheckins(userId, tz);
      return { pending, count: pending.length, timezone: tz };
    }

    case 'wl_mark_checkin_done': {
      const { findProjectByFuzzyHandle, markCheckinDone } = await import('@/lib/services/wl-checkin.service');
      const project = await findProjectByFuzzyHandle(userId, String(input.handle));
      if (!project) return { error: `No tracked project matches "${input.handle}"` };
      try {
        const { streakDays } = await markCheckinDone(userId, project.id, {
          notes: input.notes ? String(input.notes) : null,
          source: 'ai',
        });
        return { success: true, projectName: project.projectName, streakDays };
      } catch (error) {
        return { error: (error as Error).message };
      }
    }

    case 'wl_enable_checkin': {
      const { findProjectByFuzzyHandle, enableDailyCheckin } = await import('@/lib/services/wl-checkin.service');
      const project = await findProjectByFuzzyHandle(userId, String(input.handle));
      if (!project) return { error: `No tracked project matches "${input.handle}"` };
      await enableDailyCheckin(userId, project.id, {
        url: input.url ? String(input.url) : null,
        timeHint: input.timeHint ? String(input.timeHint) : null,
      });
      return { success: true, projectName: project.projectName };
    }

    case 'wl_disable_checkin': {
      const { findProjectByFuzzyHandle, disableDailyCheckin } = await import('@/lib/services/wl-checkin.service');
      const project = await findProjectByFuzzyHandle(userId, String(input.handle));
      if (!project) return { error: `No tracked project matches "${input.handle}"` };
      await disableDailyCheckin(userId, project.id);
      return { success: true, projectName: project.projectName };
    }

    case 'wl_get_checkin_streak': {
      const { findProjectByFuzzyHandle, getStreak } = await import('@/lib/services/wl-checkin.service');
      const project = await findProjectByFuzzyHandle(userId, String(input.handle));
      if (!project) return { error: `No tracked project matches "${input.handle}"` };
      const streak = await getStreak(userId, project.id);
      return { projectName: project.projectName, streakDays: streak };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ── Main Interpreter ─────────────────────────────────────────────────────────

// ── Web chat history type ─────────────────────────────────────────────────────
export interface WebChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Multi-turn web chat variant of the AI interpreter.
 * Accepts the full conversation history so the AI maintains context across
 * follow-up messages (e.g. "remove defi1" → "defi1" reply).
 * Internally shares the same providers, tools, circuit breaker, and events.
 */
export async function interpretWebMessage(
  history: WebChatMessage[],
  userId: string,
): Promise<string> {
  if (history.length === 0) return 'Please send a message.';
  // Flatten to a single user message + prior context for the routing logic
  const lastMsg = history[history.length - 1];
  const message = lastMsg?.content ?? '';
  return _interpret(message, history, userId, 'web');
}

export async function interpretTelegramMessage(
  message: string,
  userId: string,
): Promise<string> {
  return _interpret(message, [{ role: 'user', content: message }], userId, 'telegram');
}

// ── Shared core ──────────────────────────────────────────────────────────────

async function _interpret(
  message: string,
  history: WebChatMessage[],
  userId: string,
  source: 'telegram' | 'web',
): Promise<string> {
  const providers = await getAllProviders();
  if (providers.length === 0) {
    return 'AI features are not configured. Set GEMINI_API_KEY or NARA_API_KEY in your environment.\n\nUse slash commands instead:\n/mint <url> \u2022 /watch <address> \u2022 /status \u2022 /cancel \u2022 /settings';
  }

  const selectedModel = await getUserModel(userId);
  const primaryProvider = (await resolveProviderForModel(selectedModel)) ?? providers[0];
  const fallbackProvider = await getFallbackProvider(primaryProvider.name);

  // ── Circuit breaker: check if primary is healthy ──────────────────────
  // Gemini is always preferred. If Gemini is marked "down" by the circuit
  // breaker, skip it and go straight to Nara (no wasted latency on a
  // known-dead provider). But we still include it as a last-resort retry
  // in case the health check is stale.

  const primaryHealthy = await isProviderHealthy(primaryProvider.name);

  const providersToTry: { provider: ProviderConfig; model: string }[] = [];

  if (primaryHealthy) {
    // Normal path: try primary first, then fallback
    providersToTry.push({ provider: primaryProvider, model: selectedModel });
    if (fallbackProvider) {
      providersToTry.push({ provider: fallbackProvider, model: fallbackProvider.defaultModel });
    }
  } else {
    // Primary is down: try fallback first (fast path), then primary as last resort
    logger.info('Primary provider is down, using fallback first', {
      area: 'circuit-breaker',
      downProvider: primaryProvider.name,
      fallback: fallbackProvider?.name,
    });
    if (fallbackProvider) {
      providersToTry.push({ provider: fallbackProvider, model: fallbackProvider.defaultModel });
    }
    // Still try primary as last resort (maybe it recovered)
    providersToTry.push({ provider: primaryProvider, model: selectedModel });
  }

  // Publish ai:command so the web UI shows a live Telegram activity overlay
  void publishEvent(userId, 'ai:command', { message, source });

  let lastError = '';

  for (const { provider, model } of providersToTry) {
    try {
      logger.info('AI attempt', { area: 'ai-interpreter', provider: provider.name, model, userId });

      const result = await runWithProvider(provider, model, message, userId, history, source);

      // ✅ Success — record it in the circuit breaker
      void recordSuccess(provider.name);

      // If this was a fallback provider (not the user's primary), notify the dashboard
      if (provider.name !== primaryProvider.name) {
        void publishEvent(userId, 'ai:provider-switch', {
          from: primaryProvider.name,
          to: provider.name,
          reason: 'primary_failed',
        });
      }

      // Notify web UI that the Telegram command finished
      void publishEvent(userId, 'ai:command:done', { message, reply: result, source });

      return result;
    } catch (_error) {
      lastError = _error instanceof Error ? _error.message : String(_error);

      // ❌ Failure — record it in the circuit breaker
      const newStatus = await recordFailure(provider.name, lastError);

      logger.warn('AI provider failed', {
        area: 'circuit-breaker',
        failedProvider: provider.name,
        failedModel: model,
        newStatus,
        error: lastError,
        userId,
      });
    }
  }

  return `\u26a0\ufe0f All AI providers failed.\nLast error: ${lastError.slice(0, 150)}\n\nUse slash commands:\n/mint <url> \u2022 /watch <address> \u2022 /status \u2022 /cancel \u2022 /settings`;
}

/**
 * Execute a single AI request with a specific provider and model.
 * Throws on failure so the caller can retry with a fallback provider.
 */
async function runWithProvider(
  provider: ProviderConfig,
  model: string,
  message: string,
  userId: string,
  history: WebChatMessage[],
  source: 'telegram' | 'web',
): Promise<string> {
  const client = new OpenAI({
    baseURL: provider.baseURL,
    apiKey: provider.apiKey,
  });

  // Build messages: system prompt + full conversation history
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(message) },
    // Include prior turns so the AI remembers context (multi-turn web chat)
    ...history.slice(0, -1).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    // Always end with the latest user message
    { role: 'user', content: message },
  ];

  let response = await client.chat.completions.create({
    model,
    messages,
    tools: TOOLS,
    tool_choice: 'auto',
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const choice = response.choices[0];
    if (!choice) break;

    const assistantMessage = choice.message;
    const toolCalls = assistantMessage.tool_calls;
    if (!toolCalls || toolCalls.length === 0) break;

    // Push assistant message AFTER confirming there are tool calls to process.
    // Pushing before the check causes a duplicate assistant message when the
    // loop exits without tool calls — Gemini rejects consecutive assistant
    // messages, returning null content → 'Done.' fallback.
    messages.push(assistantMessage);

    for (const call of toolCalls) {
      const toolName = call.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }

      logger.info('AI tool call', { area: 'ai-interpreter', tool: toolName, input: args, userId, provider: provider.name });

      // Publish live tool activity so the web overlay tracks each running tool
      void publishEvent(userId, 'ai:command', { tool: toolName, source });

      try {
        const toolResult = await executeTool(userId, toolName, args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) });

        // \u2500\u2500 Publish real-time event to sync the web UI \u2500\u2500
        const eventType = TOOL_EVENT_MAP[toolName];
        if (eventType && !('error' in toolResult)) {
          void publishEvent(userId, eventType, { tool: toolName, ...args });
        }
      } catch (_error) {
        const errMsg = _error instanceof Error ? _error.message : String(_error);
        logger.warn('AI tool error', { area: 'ai-interpreter', tool: toolName, error: errMsg });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: errMsg }) });
      }
    }

    response = await client.chat.completions.create({
      model,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    });
  }

  // Some models (notably Gemini via OpenAI compat) return null content after
  // processing tool results. Force a text response with tool_choice: 'none'.
  const finalContent = response.choices[0]?.message?.content;
  if (finalContent) return finalContent;

  // Push the (empty-content) assistant message so the model sees the full chain,
  // then ask it to summarise without further tool calls.
  const lastMsg = response.choices[0]?.message;
  if (lastMsg) messages.push(lastMsg);

  const retry = await client.chat.completions.create({
    model,
    messages,
    tools: TOOLS,
    tool_choice: 'none',   // force text — no more tool calls
  });

  return retry.choices[0]?.message?.content || 'Done.';
}
