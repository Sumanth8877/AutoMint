import 'server-only';

import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/redis';

// ── Provider config ─────────────────────────────────────────────────────────
// Supports two AI providers via env vars:
//   AI_PROVIDER=gemini  → uses Google's OpenAI-compatible endpoint (default)
//   AI_PROVIDER=nara    → uses Nara Router
// Falls back to whichever API key is set if AI_PROVIDER is not specified.

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

export type AIModel = {
  id: string;
  label: string;
  description: string;
};

// Dynamic — depends on which provider is active.
// Exported as a getter so telegram.service.ts always sees current models.
export function getAvailableModels(): AIModel[] {
  const provider = resolveProvider();
  return provider?.models ?? [];
}

// Backward-compatible: telegram.service.ts imports AVAILABLE_MODELS and calls .map()/.find().
// We keep it as a const but resolve it lazily on first access via a module-level getter.
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

// For call sites that do `AVAILABLE_MODELS.map(...)` — they destructure and call immediately,
// so this getter is evaluated at call time (not at import time). Works in Next.js server context.
export const AVAILABLE_MODELS = {
  get length() { return getModels().length; },
  find(fn: (m: AIModel) => boolean) { return getModels().find(fn); },
  map<T>(fn: (m: AIModel) => T) { return getModels().map(fn); },
  some(fn: (m: AIModel) => boolean) { return getModels().some(fn); },
  filter(fn: (m: AIModel) => boolean) { return getModels().filter(fn); },
  forEach(fn: (m: AIModel) => void) { getModels().forEach(fn); },
  [Symbol.iterator]() { return getModels()[Symbol.iterator](); },
};

// Keep old type aliases for backward compatibility with telegram.service.ts
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

const MAX_TOOL_ROUNDS = 6;

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are AutoMint AI — an NFT minting assistant running inside a Telegram bot.
You interpret natural language and execute actions using the available tools.

CAPABILITIES:
• Watch wallets (whale tracking) via Alchemy webhooks
• Set up copy-mint rules — auto-mint when a watched wallet mints
• Create instant mint tasks from collection URLs
• Check mint task status and cancel tasks
• Diagnose why a mint failed — analyze the execution logs and explain the root cause
• Check wallet balance

COPY-MINT RULES:
• walletAddress — the whale wallet to monitor
• maxPrice — maximum mint price in ETH (convert from USD if needed: assume 1 ETH ≈ $2500)
• quantity — how many NFTs YOUR user wants to mint when the rule triggers
• minMintCount — minimum mints by the whale in the same collection before the rule fires (default 1)
• autoMint — true = execute immediately without confirmation
• riskThreshold — max risk score to allow (0-100, default 75)

RULES:
• Be concise — this is Telegram, not email
• Use emoji sparingly for clarity
• Prices are in ETH unless the user says otherwise — convert USD to ETH using ~$2500/ETH
• If you need more info to proceed, ask the user
• After executing tools, summarize what you did in plain language
• When the user provides a wallet address, validate it looks like 0x... (42 chars) before using it
• Always call the appropriate tools — never just describe what you would do
• DIAGNOSING FAILURES: When the user asks why a mint failed / what went wrong / why it did not work, ALWAYS call diagnose_mint_failure FIRST. Read the returned failureReason, the log timeline, walletBalance and mintCost, then explain the ROOT CAUSE in plain language and give a concrete fix. ALWAYS include the USD values — walletBalance and mintCost already contain them (e.g. "0.00008 ETH (~$0.21)") — so the user knows how much real money to add. Do NOT reply with generic answers like "I can show you the status" — actually analyze and answer. Example: "Your Rarible Pepes mint failed because wallet 0x99…e5b1 has only 0.00008 ETH (~$0.21), but the mint costs 0.001 ETH (~$2.50) + ~$8 gas. Add about $11 of ETH to the wallet and retry." Map common reasons to fixes: insufficient/low balance → tell them the exact USD to add; sold out / ended → mint is over, nothing to do; reverted / wrong phase → public mint not open or allowlist-only; price unknown → set the price manually; nonce conflict → retry.`;

// ── Tool Declarations (OpenAI format) ────────────────────────────────────────

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'watch_wallet',
      description:
        'Add a wallet address to the whale tracker. Monitors on-chain activity (mints, purchases, transfers) via Alchemy webhooks.',
      parameters: {
        type: 'object',
        properties: {
          walletAddress: {
            type: 'string',
            description: 'The EVM wallet address (0x...)',
          },
          chain: {
            type: 'string',
            description:
              'Chain to monitor: ethereum, base, polygon, or arbitrum. Default: ethereum',
          },
          walletName: {
            type: 'string',
            description: 'Optional friendly label for the wallet',
          },
        },
        required: ['walletAddress'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_copy_mint_rule',
      description:
        'Create or update a copy-mint rule for a watched wallet. When the wallet mints NFTs matching the conditions, AutoMint will auto-mint for the user.',
      parameters: {
        type: 'object',
        properties: {
          walletAddress: {
            type: 'string',
            description: 'The watched wallet address (0x...)',
          },
          maxPrice: {
            type: 'string',
            description:
              'Maximum mint price in ETH (e.g. "0.002" for ~$5). Omit for no limit.',
          },
          quantity: {
            type: 'number',
            description: 'How many NFTs to mint when triggered (default: 1)',
          },
          minMintCount: {
            type: 'number',
            description:
              'Minimum number of mints by the whale in the same collection before triggering (default: 1). Set to 5 if user says "if they mint 5+".',
          },
          autoMint: {
            type: 'boolean',
            description:
              'true = mint automatically without confirmation. false = notify only.',
          },
          riskThreshold: {
            type: 'number',
            description:
              'Maximum risk score to allow (0-100, default 75). Higher = more permissive.',
          },
        },
        required: ['walletAddress'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mint_from_url',
      description:
        'Create an instant mint task from a collection URL (OpenSea, Etherscan, or any mint page).',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The mint page URL',
          },
          quantity: {
            type: 'number',
            description: 'Number of NFTs to mint (default: 1)',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_mints',
      description: 'Get the status of active/pending mint tasks.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'diagnose_mint_failure',
      description:
        'Diagnose why a mint failed or what went wrong. Returns the most recent mint task (or one for a specific contract) with its full execution log timeline, the real error reason, mint price, quantity, wallet address and current wallet balance. ALWAYS call this when the user asks why a mint failed, what went wrong, or why it did not work — then analyze the logs and explain the ROOT CAUSE.',
      parameters: {
        type: 'object',
        properties: {
          contractAddress: {
            type: 'string',
            description: 'Optional contract address (0x...) to diagnose a specific collection. Omit to diagnose the most recent mint task.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_mint',
      description: 'Cancel a pending or scheduled mint task by its task ID.',
      parameters: {
        type: 'object',
        properties: {
          taskId: {
            type: 'string',
            description: 'The mint task ID to cancel',
          },
        },
        required: ['taskId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_watched_wallets',
      description: 'List all currently watched wallets and their status.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_copy_mint_rules',
      description: 'List all active copy-mint rules.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_wallet_balance',
      description: "Check the ETH balance of the user's wallet.",
      parameters: {
        type: 'object',
        properties: {
          chain: {
            type: 'string',
            description:
              'Chain to check: ethereum, base, polygon, or arbitrum. Default: ethereum',
          },
        },
      },
    },
  },
];

// ── Tool Executor ────────────────────────────────────────────────────────────

async function executeTool(
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case 'watch_wallet': {
      const { watchWallet } = await import(
        '@/lib/services/wallet-tracker.service'
      );
      const result = await watchWallet(userId, {
        walletAddress: String(input.walletAddress),
        chain: String(input.chain ?? 'ethereum'),
        walletName: input.walletName ? String(input.walletName) : null,
      });
      return { success: true, ...result };
    }

    case 'create_copy_mint_rule': {
      const { upsertCopyMintRule } = await import(
        '@/lib/services/copy-mint.service'
      );
      const result = await upsertCopyMintRule(userId, {
        walletAddress: String(input.walletAddress),
        maxPrice: input.maxPrice !== undefined ? String(input.maxPrice) : null,
        quantity: input.quantity !== undefined ? Number(input.quantity) : 1,
        minMintCount:
          input.minMintCount !== undefined ? Number(input.minMintCount) : 1,
        autoMint:
          input.autoMint !== undefined ? Boolean(input.autoMint) : false,
        riskThreshold:
          input.riskThreshold !== undefined
            ? Number(input.riskThreshold)
            : undefined,
      });
      return {
        success: true,
        ruleId: result.id,
        walletAddress: result.walletAddress,
      };
    }

    case 'mint_from_url': {
      const { createMintTaskFromUrl } = await import(
        '@/lib/services/mint-orchestrator.service'
      );
      const { getDb: getDb2 } = await import('@/lib/db');
      const { wallets: walletsTable } = await import('@/drizzle/schema');
      const { eq: eq2 } = await import('drizzle-orm');
      const [defaultWallet] = await getDb2()
        .select({ id: walletsTable.id })
        .from(walletsTable)
        .where(eq2(walletsTable.userId, userId))
        .limit(1);
      if (!defaultWallet)
        return { error: 'No wallet configured. Add a wallet first.' };
      const result = await createMintTaskFromUrl(
        String(input.url),
        defaultWallet.id,
        userId,
        input.quantity ? Number(input.quantity) : 1,
      );
      return {
        success: true,
        action: result.action,
        taskId: result.taskId,
        error: result.error,
      };
    }

    case 'get_active_mints': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks } = await import('@/drizzle/schema');
      const { and, eq, inArray, desc } = await import('drizzle-orm');
      const tasks = await getDb()
        .select({
          id: mintTasks.id,
          status: mintTasks.status,
          contractAddress: mintTasks.contractAddress,
          quantity: mintTasks.quantity,
          mintPrice: mintTasks.mintPrice,
          createdAt: mintTasks.createdAt,
          scheduledTime: mintTasks.scheduledTime,
        })
        .from(mintTasks)
        .where(
          and(
            eq(mintTasks.userId, userId),
            inArray(mintTasks.status, [
              'pending',
              'monitoring',
              'ready',
              'running',
            ]),
          ),
        )
        .orderBy(desc(mintTasks.createdAt))
        .limit(10);
      return { tasks, count: tasks.length };
    }

    case 'diagnose_mint_failure': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks, taskLogs, wallets } = await import('@/drizzle/schema');
      const { and, eq, desc } = await import('drizzle-orm');

      const contract = input.contractAddress ? String(input.contractAddress).toLowerCase() : null;
      const conditions = contract
        ? and(eq(mintTasks.userId, userId), eq(mintTasks.contractAddress, contract))
        : eq(mintTasks.userId, userId);

      const [task] = await getDb()
        .select()
        .from(mintTasks)
        .where(conditions)
        .orderBy(desc(mintTasks.createdAt))
        .limit(1);

      if (!task) {
        return { found: false, message: 'No mint tasks found to diagnose.' };
      }

      const logs = await getDb()
        .select({
          event: taskLogs.event,
          status: taskLogs.status,
          message: taskLogs.message,
          createdAt: taskLogs.createdAt,
        })
        .from(taskLogs)
        .where(eq(taskLogs.taskId, task.id))
        .orderBy(desc(taskLogs.createdAt))
        .limit(25);

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
            const [bal, usdPrice] = await Promise.all([
              getWalletBalance(w.address, w.chain),
              getNativeTokenUsdPrice(w.chain).catch(() => 0),
            ]);
            walletBalance = usdPrice ? formatWithUsd(bal.balance, bal.symbol, usdPrice) : `${bal.balance} ${bal.symbol}`;
            if (task.mintPrice) {
              const costEth = Number(task.mintPrice) * task.quantity;
              mintCost = usdPrice ? formatWithUsd(costEth, bal.symbol, usdPrice) : `${costEth} ${bal.symbol}`;
            }
          } catch {
            /* balance/price fetch is best-effort */
          }
        }
      }

      const errorLog = logs.find((l) => l.status === 'error');

      return {
        found: true,
        task: {
          id: task.id,
          status: task.status,
          contractAddress: task.contractAddress,
          mintPrice: task.mintPrice,
          quantity: task.quantity,
          phase: task.phase,
          txHash: task.txHash,
          createdAt: task.createdAt,
        },
        failureReason: errorLog?.message ?? null,
        walletAddress,
        walletBalance,
        mintCost,
        logs: logs.reverse(),
      };
    }

    case 'cancel_mint': {
      const { getDb } = await import('@/lib/db');
      const { mintTasks } = await import('@/drizzle/schema');
      const { and, eq, inArray } = await import('drizzle-orm');
      const [updated] = await getDb()
        .update(mintTasks)
        .set({ status: 'cancelled' })
        .where(
          and(
            eq(mintTasks.id, String(input.taskId)),
            eq(mintTasks.userId, userId),
            inArray(mintTasks.status, ['pending', 'monitoring', 'ready']),
          ),
        )
        .returning({ id: mintTasks.id });
      if (!updated)
        return { success: false, error: 'Task not found or not cancellable' };
      return { success: true, cancelledTaskId: updated.id };
    }

    case 'get_watched_wallets': {
      const { getUserWatchedWallets } = await import(
        '@/lib/services/wallet-tracker.service'
      );
      const walletsList = await getUserWatchedWallets(userId);
      return { wallets: walletsList, count: walletsList.length };
    }

    case 'get_copy_mint_rules': {
      const { getCopyMintRules } = await import(
        '@/lib/services/copy-mint.service'
      );
      const rules = await getCopyMintRules(userId);
      return { rules, count: rules.length };
    }

    case 'get_wallet_balance': {
      const { getDb } = await import('@/lib/db');
      const { wallets } = await import('@/drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const chain = String(input.chain ?? 'ethereum') as
        | 'ethereum'
        | 'base'
        | 'polygon'
        | 'arbitrum';
      const [wallet] = await getDb()
        .select({
          address: wallets.address,
          balance: wallets.balance,
          balanceSymbol: wallets.balanceSymbol,
          chain: wallets.chain,
        })
        .from(wallets)
        .where(and(eq(wallets.userId, userId), eq(wallets.chain, chain)))
        .limit(1);
      if (!wallet) return { error: `No wallet found on ${chain}` };
      return {
        address: wallet.address,
        balance: wallet.balance,
        symbol: wallet.balanceSymbol,
        chain: wallet.chain,
      };
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
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }

        logger.info('AI tool call', {
          area: 'ai-interpreter',
          tool: toolName,
          input: args,
          userId,
        });

        try {
          const toolResult = await executeTool(userId, toolName, args);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(toolResult),
          });
        } catch (error) {
          const errMsg =
            error instanceof Error ? error.message : String(error);
          logger.warn('AI tool error', {
            area: 'ai-interpreter',
            tool: toolName,
            error: errMsg,
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: errMsg }),
          });
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `⚠️ AI request failed: ${msg.slice(0, 180)}\n\nYou can still use slash commands:\n/mint <url> • /watch <address> • /status • /cancel • /settings`;
  }
}
