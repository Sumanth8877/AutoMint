import 'server-only';

import {
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclarationsTool,
  type Part,
} from '@google/generative-ai';
import { logger } from '@/lib/logger';
import { getRedisClient } from '@/lib/redis';

// Model management

const DEFAULT_MODEL = 'gemini-2.5-flash';

export type GeminiModelId =
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.0-flash'
  | 'gemini-1.5-flash'
  | 'gemini-1.5-flash-8b';

export type GeminiModel = {
  id: GeminiModelId;
  label: string;
  description: string;
};

export const AVAILABLE_MODELS: GeminiModel[] = [
  { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash ⭐',    description: 'Recommended — fast, smart, supports tools' },
  { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro',         description: 'Most capable — best for complex commands' },
  { id: 'gemini-2.5-flash-lite',  label: 'Gemini 2.5 Flash Lite',  description: 'Lightest 2.5 — fastest response time' },
  { id: 'gemini-2.0-flash',       label: 'Gemini 2.0 Flash',       description: 'Fast & reliable — solid all-rounder' },
  { id: 'gemini-1.5-flash',       label: 'Gemini 1.5 Flash',       description: 'Proven stable model — highly reliable' },
  { id: 'gemini-1.5-flash-8b',    label: 'Gemini 1.5 Flash 8B',    description: 'Smallest model — ultra-low latency' },
];

function modelKey(userId: string) { return `ai:model:${userId}`; }

export async function getUserModel(userId: string): Promise<GeminiModelId> {
  try {
    const stored = await getRedisClient().get<string>(modelKey(userId));
    if (stored && AVAILABLE_MODELS.some(m => m.id === stored)) return stored as GeminiModelId;
  } catch { /* Redis unavailable */ }
  return DEFAULT_MODEL;
}

export async function setUserModel(userId: string, modelId: GeminiModelId): Promise<void> {
  // L-03 fix: 30-day TTL (was 365 days). getUserModel() already falls back to
  // DEFAULT_MODEL when a stored id is no longer in AVAILABLE_MODELS, but a shorter
  // TTL means deprecated model preferences auto-reset within a month rather than a year.
  await getRedisClient().set(modelKey(userId), modelId, { ex: 60 * 60 * 24 * 30 });
}

// ── Config ───────────────────────────────────────────────────────────────────

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

// ── Tool Declarations ────────────────────────────────────────────────────────

const TOOLS: FunctionDeclarationsTool[] = [
  {
    functionDeclarations: [
      {
        name: 'watch_wallet',
        description:
          'Add a wallet address to the whale tracker. Monitors on-chain activity (mints, purchases, transfers) via Alchemy webhooks.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            walletAddress: {
              type: SchemaType.STRING,
              description: 'The EVM wallet address (0x...)',
            },
            chain: {
              type: SchemaType.STRING,
              description:
                'Chain to monitor: ethereum, base, polygon, or arbitrum. Default: ethereum',
            },
            walletName: {
              type: SchemaType.STRING,
              description: 'Optional friendly label for the wallet',
            },
          },
          required: ['walletAddress'],
        },
      },
      {
        name: 'create_copy_mint_rule',
        description:
          'Create or update a copy-mint rule for a watched wallet. When the wallet mints NFTs matching the conditions, AutoMint will auto-mint for the user.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            walletAddress: {
              type: SchemaType.STRING,
              description: 'The watched wallet address (0x...)',
            },
            maxPrice: {
              type: SchemaType.STRING,
              description:
                'Maximum mint price in ETH (e.g. "0.002" for ~$5). Omit for no limit.',
            },
            quantity: {
              type: SchemaType.NUMBER,
              description: 'How many NFTs to mint when triggered (default: 1)',
            },
            minMintCount: {
              type: SchemaType.NUMBER,
              description:
                'Minimum number of mints by the whale in the same collection before triggering (default: 1). Set to 5 if user says "if they mint 5+".',
            },
            autoMint: {
              type: SchemaType.BOOLEAN,
              description:
                'true = mint automatically without confirmation. false = notify only.',
            },
            riskThreshold: {
              type: SchemaType.NUMBER,
              description:
                'Maximum risk score to allow (0-100, default 75). Higher = more permissive.',
            },
          },
          required: ['walletAddress'],
        },
      },
      {
        name: 'mint_from_url',
        description:
          'Create an instant mint task from a collection URL (OpenSea, Etherscan, or any mint page).',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            url: {
              type: SchemaType.STRING,
              description: 'The mint page URL',
            },
            quantity: {
              type: SchemaType.NUMBER,
              description: 'Number of NFTs to mint (default: 1)',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'get_active_mints',
        description: 'Get the status of active/pending mint tasks.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: 'diagnose_mint_failure',
        description:
          'Diagnose why a mint failed or what went wrong. Returns the most recent mint task (or one for a specific contract) with its full execution log timeline, the real error reason, mint price, quantity, wallet address and current wallet balance. ALWAYS call this when the user asks why a mint failed, what went wrong, or why it did not work — then analyze the logs and explain the ROOT CAUSE.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            contractAddress: {
              type: SchemaType.STRING,
              description: 'Optional contract address (0x...) to diagnose a specific collection. Omit to diagnose the most recent mint task.',
            },
          },
        },
      },
      {
        name: 'cancel_mint',
        description: 'Cancel a pending or scheduled mint task by its task ID.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            taskId: {
              type: SchemaType.STRING,
              description: 'The mint task ID to cancel',
            },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'get_watched_wallets',
        description: 'List all currently watched wallets and their status.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: 'get_copy_mint_rules',
        description: 'List all active copy-mint rules.',
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: 'get_wallet_balance',
        description: "Check the ETH balance of the user's wallet.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            chain: {
              type: SchemaType.STRING,
              description:
                'Chain to check: ethereum, base, polygon, or arbitrum. Default: ethereum',
            },
          },
        },
      },
    ],
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

      // Find the target task: a specific contract if given, else the most recent.
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

      // Full execution log timeline for this task (chronological order)
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

      // Current wallet balance + mint cost in ETH and USD — the #1 cause of
      // mint failures is an underfunded wallet, and showing $ makes the fix
      // obvious ("add ~$10 of ETH" beats "add 0.004 ETH").
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

      // Most recent error-level log = the proximate failure reason
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
        logs: logs.reverse(), // chronological for easier reasoning
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return 'AI features are not configured. Set GEMINI_API_KEY in your environment.\n\nUse slash commands instead:\n/mint <url> • /watch <address> • /status • /cancel • /settings';
  }

  const selectedModel = await getUserModel(userId);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: selectedModel,
      systemInstruction: SYSTEM_PROMPT,
      tools: TOOLS,
    });

    const chat = model.startChat();
    let result = await chat.sendMessage(message);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = result.response.functionCalls();
      if (!calls || calls.length === 0) break;

      const responseParts: Part[] = [];

      for (const call of calls) {
        logger.info('AI tool call', {
          area: 'ai-interpreter',
          tool: call.name,
          input: call.args,
          userId,
        });

        try {
          const toolResult = await executeTool(
            userId,
            call.name,
            (call.args ?? {}) as Record<string, unknown>,
          );
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: toolResult,
            },
          });
        } catch (error) {
          const errMsg =
            error instanceof Error ? error.message : String(error);
          logger.warn('AI tool error', {
            area: 'ai-interpreter',
            tool: call.name,
            error: errMsg,
          });
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: { error: errMsg },
            },
          });
        }
      }

      result = await chat.sendMessage(responseParts);
    }

    return result.response.text() || 'Done.';
  } catch (error) {
    // Return a useful message instead of throwing — a thrown error surfaces to
    // the user as the misleading "Unknown command". Showing the real reason
    // (e.g. an invalid model name or quota error) makes the bot diagnosable.
    const msg = error instanceof Error ? error.message : String(error);
    return `⚠️ AI request failed: ${msg.slice(0, 180)}\n\nYou can still use slash commands:\n/mint <url> • /watch <address> • /status • /cancel • /settings`;
  }
}
