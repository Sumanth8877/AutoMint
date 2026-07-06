import 'server-only';

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/redis';

// ── Provider config ─────────────────────────────────────────────────────────

type ProviderConfig = {
  name: string;
  baseURL: string;
  apiKey: string;
  defaultModel: string;
  models: AIModel[];
};

const GEMINI_MODELS: AIModel[] = [
  { id: 'gemini-3.5-flash',      label: 'Gemini 3.5 Flash ⭐',     description: 'Most intelligent — frontier agentic performance' },
  { id: 'gemini-3.1-flash',      label: 'Gemini 3.1 Flash',        description: 'Cost-efficient — optimized for high-volume tasks' },
  { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',        description: 'Fast & reliable — solid all-rounder' },
  { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',          description: 'Deep reasoning — best for complex analysis' },
];

const NARA_MODELS: AIModel[] = [
  { id: 'mistral-large',      label: 'Mistral Large ⭐',      description: 'Recommended — smart, supports tools' },
  { id: 'mistral-medium-3-5', label: 'Mistral Medium 3.5',    description: 'Balanced — good speed & quality' },
  { id: 'tencent-hy3',        label: 'Tencent Hy3',           description: 'Alternative — fast responses' },
];

function resolveProvider(): ProviderConfig | null {
  const explicit = process.env.AI_PROVIDER?.toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY;
  const naraKey = process.env.NARA_API_KEY;

  if (explicit === 'gemini' || (!explicit && geminiKey)) {
    if (!geminiKey) return null;
    return {
      name: 'Gemini',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: geminiKey,
      defaultModel: 'gemini-3.5-flash',
      models: GEMINI_MODELS,
    };
  }

  if (explicit === 'nara' || (!explicit && naraKey)) {
    if (!naraKey) return null;
    return {
      name: 'NaraRouter',
      baseURL: 'https://router.bynara.id/v1',
      apiKey: naraKey,
      defaultModel: 'mistral-large',
      models: NARA_MODELS,
    };
  }

  return null;
}

// ── Model management ────────────────────────────────────────────────────────

export type AIModelId = string;
export type AIModel = { id: string; label: string; description: string; };

export function getAvailableModels(): AIModel[] {
  return resolveProvider()?.models ?? [];
}

let _modelsCache: AIModel[] | null = null;
let _modelsCacheProvider: string | null = null;
export function getModels(): AIModel[] {
  const provider = resolveProvider();
  const key = provider?.name ?? '';
  if (_modelsCache && _modelsCacheProvider === key) return _modelsCache;
  _modelsCache = provider?.models ?? [];
  _modelsCacheProvider = key;
  return _modelsCache;
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
  const provider = resolveProvider();
  const models = provider?.models ?? [];
  try {
    const stored = await getRedisClient().get<string>(modelKey(userId));
    if (stored && models.some(m => m.id === stored)) return stored;
  } catch { /* Redis unavailable */ }
  return provider?.defaultModel ?? 'mistral-large';
}

export async function setUserModel(userId: string, modelId: string): Promise<void> {
  await getRedisClient().set(modelKey(userId), modelId, { ex: 60 * 60 * 24 * 30 });
}

// ── Config ─────────────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 8;

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are AutoMint AI — a full-featured NFT minting assistant with complete control over the AutoMint platform. You run inside a Telegram bot and interpret natural language to execute any action the web app can do.

CAPABILITIES:
• Wallet management — list wallets, check balances (across all EVM chains)
• Whale tracking — watch wallets, view activity, set up copy-mint rules
• Minting — create instant mint tasks from URLs, check status, cancel, retry failed mints
• Contract analysis — run the full analyzer pipeline (risk scoring, ABI discovery, on-chain data)
• Analytics — success rates, gas spent, trends, full mint history with execution logs
• Collections — view tracked collections with floor prices
• Discovery — look up collections on OpenSea
• Settings — view/update gas strategy, risk analysis, notification preferences
• System — health checks, diagnostics
• Search — full-text search across all data

COPY-MINT RULES:
• walletAddress — the whale wallet to monitor
• maxPrice — max mint price in ETH (convert from USD: 1 ETH ≈ $2500)
• quantity — how many NFTs YOUR user mints when rule triggers
• minMintCount — min mints by whale before rule fires (default 1)
• autoMint — true = execute immediately without confirmation
• riskThreshold — max risk score to allow (0-100, default 75)

GAS STRATEGIES: slow, normal, fast, aggressive

RULES:
• Be concise — this is Telegram, not email
• Use emoji sparingly for clarity
• Prices are in ETH unless user says otherwise — convert USD via ~$2500/ETH
• If you need more info, ask the user
• After executing tools, summarize what you did in plain language
• Validate wallet addresses look like 0x... (42 chars) before using them
• Always call the appropriate tools — never just describe what you would do
• DIAGNOSING FAILURES: When user asks why a mint failed, ALWAYS call diagnose_mint_failure FIRST. Read failureReason, log timeline, walletBalance and mintCost, then explain the ROOT CAUSE with exact USD values and a concrete fix.
• When updating settings, always show the user what changed.`;

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

];

// ── Tool Executor ────────────────────────────────────────────────────────────

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
      const { eq: eq2 } = await import('drizzle-orm');
      const [defaultWallet] = await getDb2()
        .select({ id: walletsTable.id })
        .from(walletsTable)
        .where(eq2(walletsTable.userId, userId))
        .limit(1);
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
      const { monitoredWebsites } = await import('@/drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const rows = await getDb().select().from(monitoredWebsites).where(eq(monitoredWebsites.userId, userId));
      return { websites: rows, count: rows.length };
    }

    case 'add_monitoring_website': {
      const { getDb } = await import('@/lib/db');
      const { monitoredWebsites } = await import('@/drizzle/schema');
      const [created] = await getDb().insert(monitoredWebsites).values({ userId, url: String(input.url), name: input.name ? String(input.name) : String(input.url) }).returning();
      return { success: true, website: created };
    }

    case 'remove_monitoring_website': {
      const { getDb } = await import('@/lib/db');
      const { monitoredWebsites } = await import('@/drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const [deleted] = await getDb().delete(monitoredWebsites).where(and(eq(monitoredWebsites.id, String(input.websiteId)), eq(monitoredWebsites.userId, userId))).returning({ id: monitoredWebsites.id });
      if (!deleted) return { error: 'Website monitor not found' };
      return { success: true, deletedId: deleted.id };
    }

    case 'get_monitoring_events': {
      const { getDb } = await import('@/lib/db');
      const { websiteEvents, monitoredWebsites } = await import('@/drizzle/schema');
      const { eq, desc, inArray } = await import('drizzle-orm');
      const limit = Math.min(Number(input.limit ?? 20), 50);
      // Get user's website IDs first, then their events
      const userSites = await getDb().select({ id: monitoredWebsites.id }).from(monitoredWebsites).where(eq(monitoredWebsites.userId, userId));
      const siteIds = userSites.map(s => s.id);
      if (siteIds.length === 0) return { events: [], count: 0 };
      const rows = await getDb().select().from(websiteEvents).where(inArray(websiteEvents.websiteId, siteIds)).orderBy(desc(websiteEvents.createdAt)).limit(limit);
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
      const state = await getMintState(String(input.contractAddress), String(input.chain ?? 'ethereum'), null);
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
      const { deleteUserData } = await import('@/lib/services/account-deletion.service');
      await deleteUserData(userId);
      return { success: true, message: 'All data has been permanently deleted.' };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ── Main Interpreter ─────────────────────────────────────────────────────────

export async function interpretTelegramMessage(
  message: string,
  userId: string,
): Promise<string> {
  const provider = resolveProvider();
  if (!provider) {
    return 'AI features are not configured. Set GEMINI_API_KEY or NARA_API_KEY in your environment.\n\nUse slash commands instead:\n/mint <url> • /watch <address> • /status • /cancel • /settings';
  }

  const selectedModel = await getUserModel(userId);

  try {
    const client = new OpenAI({
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
    });

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ];

    let response = await client.chat.completions.create({
      model: selectedModel,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const choice = response.choices[0];
      if (!choice) break;

      const assistantMessage = choice.message;
      messages.push(assistantMessage);

      const toolCalls = assistantMessage.tool_calls;
      if (!toolCalls || toolCalls.length === 0) break;

      for (const call of toolCalls) {
        const toolName = call.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }

        logger.info('AI tool call', { area: 'ai-interpreter', tool: toolName, input: args, userId });

        try {
          const toolResult = await executeTool(userId, toolName, args);
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) });
        } catch (_error) {
          const errMsg = _error instanceof Error ? _error.message : String(_error);
          logger.warn('AI tool error', { area: 'ai-interpreter', tool: toolName, error: errMsg });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: errMsg }) });
        }
      }

      response = await client.chat.completions.create({
        model: selectedModel,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
      });
    }

    return response.choices[0]?.message?.content || 'Done.';
  } catch (_error) {
    const msg = _error instanceof Error ? _error.message : String(_error);
    return `⚠️ AI request failed: ${msg.slice(0, 180)}\n\nYou can still use slash commands:\n/mint <url> • /watch <address> • /status • /cancel • /settings`;
  }
}
