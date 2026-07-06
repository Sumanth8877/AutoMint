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
      const { enqueueMintExecution } = await import('@/lib/services/qstash.service');
      await enqueueMintExecution(retried.id);
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
      const { analyzeUrl } = await import('@/lib/services/analyzer.service');
      const { normalizeAnalyzerInput } = await import('@/lib/services/analyzer-resolver.service');
      const rawInput = String(input.input);
      const chain = String(input.chain ?? 'ethereum');
      const normalized = normalizeAnalyzerInput(rawInput);
      const result = await analyzeUrl(rawInput, userId);
      // Return a condensed summary for the AI
      return {
        success: true,
        contractAddress: result.contractAddress,
        chain: result.chain,
        name: result.name,
        mintStatus: result.mintStatus,
        mintPrice: result.mintPrice,
        totalSupply: result.totalSupply,
        mintedCount: result.mintedCount,
        mintFunction: result.mintFunction,
        risk: result.risk,
        performanceMetrics: result.performanceMetrics,
      };
    }

    // ─── Analytics & History ───
    case 'get_analytics': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, mintHistory } = await import('@/drizzle/schema');
      const { eq, count, sql, and, gte } = await import('drizzle-orm');
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
        .select({ id: collections.id, name: collections.name, contractAddress: collections.contractAddress, chain: collections.chain, imageUrl: collections.imageUrl, createdAt: collections.createdAt })
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
      const { updateExecutionDefaults } = await import('@/lib/services/execution-settings.service');
      const updates: Record<string, unknown> = {};
      if (input.gasStrategy !== undefined) updates.gasStrategy = String(input.gasStrategy);
      if (input.riskAnalysisEnabled !== undefined) updates.riskAnalysisEnabled = Boolean(input.riskAnalysisEnabled);
      if (input.safeModeEnabled !== undefined) updates.safeModeEnabled = Boolean(input.safeModeEnabled);
      if (input.maxGasPriceGwei !== undefined) updates.maxGasPriceGwei = Number(input.maxGasPriceGwei);
      if (input.maxMintPriceEth !== undefined) updates.maxMintPriceEth = String(input.maxMintPriceEth);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await updateExecutionDefaults(userId, updates as any);
      return { success: true, updated: result };
    }

    case 'get_notification_settings': {
      const { getIntegrationSettings } = await import('@/lib/services/integration-settings.service');
      const settings = await getIntegrationSettings(userId);
      return { ...settings };
    }

    case 'update_notification_settings': {
      const { updateIntegrationSettings } = await import('@/lib/services/integration-settings.service');
      const updates: Record<string, unknown> = {};
      if (input.emailEnabled !== undefined) updates.emailEnabled = Boolean(input.emailEnabled);
      if (input.telegramEnabled !== undefined) updates.telegramEnabled = Boolean(input.telegramEnabled);
      if (input.notifyOnMintSuccess !== undefined) updates.notifyOnMintSuccess = Boolean(input.notifyOnMintSuccess);
      if (input.notifyOnMintFailure !== undefined) updates.notifyOnMintFailure = Boolean(input.notifyOnMintFailure);
      if (input.notifyOnWhaleActivity !== undefined) updates.notifyOnWhaleActivity = Boolean(input.notifyOnWhaleActivity);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await updateIntegrationSettings(userId, updates as any);
      return { success: true, updated: result };
    }

    // ─── System ───
    case 'get_system_status': {
      const { getSystemHealthReport } = await import('@/lib/services/system-status.service');
      const report = await getSystemHealthReport();
      return { ...report };
    }

    // ─── Search ───
    case 'search_data': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, collections, wallets, watchedWallets } = await import('@/drizzle/schema');
      const { eq, or, ilike, desc } = await import('drizzle-orm');
      const q = `%${String(input.query)}%`;
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
      const filteredMints = mintResults.filter(m => m.contractAddress?.toLowerCase().includes(query) || m.status?.toLowerCase().includes(query));
      const filteredCollections = collectionResults.filter(c => c.name?.toLowerCase().includes(query) || c.contractAddress?.toLowerCase().includes(query));
      const filteredWallets = walletResults.filter(w => w.address?.toLowerCase().includes(query) || w.chain?.toLowerCase().includes(query));
      return { mints: filteredMints, collections: filteredCollections, wallets: filteredWallets, totalResults: filteredMints.length + filteredCollections.length + filteredWallets.length };
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
