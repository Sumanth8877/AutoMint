import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { addBreadcrumb, captureException } from '@/lib/observability/sentry';
import { logger } from '@/lib/logger';

// ── Config ───────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 6;

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are AutoMint AI — an NFT minting assistant running inside a Telegram bot.
You interpret natural language and execute actions using the available tools.

CAPABILITIES:
• Watch wallets (whale tracking) via Alchemy webhooks
• Set up copy-mint rules — auto-mint when a watched wallet mints
• Create instant mint tasks from collection URLs
• Check mint task status and cancel tasks
• Check wallet balance and gas prices

COPY-MINT RULES:
• walletAddress — the whale wallet to monitor
• maxPrice — maximum mint price in ETH (convert from USD if needed: assume 1 ETH ≈ $2500)
• quantity — how many NFTs YOUR user wants to mint when the rule triggers
• minMintCount — minimum mints by the whale in the same collection before the rule fires (default 1)
• autoMint — true = execute immediately without confirmation
• riskThreshold — max risk score to allow (0-100, default 75)

RULES:
• Always confirm what you're about to do before executing destructive actions
• Be concise — this is Telegram, not email
• Use emoji sparingly for clarity
• Prices are in ETH unless the user says otherwise — convert USD to ETH using ~$2500/ETH
• If you need more info to proceed, ask the user
• After executing tools, summarize what you did in plain language
• When the user provides a wallet address, validate it looks like 0x... (42 chars) before using it`;

// ── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'watch_wallet',
    description: 'Add a wallet address to the whale tracker. Monitors on-chain activity (mints, purchases, transfers) via Alchemy webhooks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        walletAddress: { type: 'string', description: 'The EVM wallet address (0x...)' },
        chain: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum'], description: 'Chain to monitor (default: ethereum)' },
        walletName: { type: 'string', description: 'Optional friendly label for the wallet' },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'create_copy_mint_rule',
    description: 'Create or update a copy-mint rule for a watched wallet. When the wallet mints NFTs matching the conditions, AutoMint will auto-mint for the user.',
    input_schema: {
      type: 'object' as const,
      properties: {
        walletAddress: { type: 'string', description: 'The watched wallet address (0x...)' },
        maxPrice: { type: 'string', description: 'Maximum mint price in ETH (e.g. "0.002" for ~$5). Set to null for no limit.' },
        quantity: { type: 'number', description: 'How many NFTs to mint when triggered (default: 1)' },
        minMintCount: { type: 'number', description: 'Minimum number of mints by the whale in the same collection before triggering (default: 1). Set to 5 if user says "if they mint 5+".' },
        autoMint: { type: 'boolean', description: 'true = mint automatically without confirmation. false = notify only.' },
        riskThreshold: { type: 'number', description: 'Maximum risk score to allow (0-100, default 75). Higher = more permissive.' },
      },
      required: ['walletAddress'],
    },
  },
  {
    name: 'mint_from_url',
    description: 'Create an instant mint task from a collection URL (OpenSea, Etherscan, or any mint page).',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The mint page URL' },
        quantity: { type: 'number', description: 'Number of NFTs to mint (default: 1)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_active_mints',
    description: 'Get the status of active/pending mint tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'cancel_mint',
    description: 'Cancel a pending or scheduled mint task by its task ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        taskId: { type: 'string', description: 'The mint task ID to cancel' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'get_watched_wallets',
    description: 'List all currently watched wallets and their status.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_copy_mint_rules',
    description: 'List all active copy-mint rules.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_wallet_balance',
    description: 'Check the ETH balance of the user\'s default wallet.',
    input_schema: {
      type: 'object' as const,
      properties: {
        chain: { type: 'string', enum: ['ethereum', 'base', 'polygon', 'arbitrum'], description: 'Chain to check (default: ethereum)' },
      },
    },
  },
];

// ── Tool Executor ────────────────────────────────────────────────────────────

async function executeTool(
  userId: string,
  toolName: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (toolName) {
    case 'watch_wallet': {
      const { watchWallet } = await import('@/lib/services/wallet-tracker.service');
      const result = await watchWallet(userId, {
        walletAddress: String(input.walletAddress),
        chain: String(input.chain ?? 'ethereum'),
        walletName: input.walletName ? String(input.walletName) : null,
      });
      return { success: true, ...result };
    }

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

    case 'mint_from_url': {
      const { createMintTaskFromUrl } = await import('@/lib/services/mint-orchestrator.service');
      // Load the user's default wallet
      const { getDb: getDb2 } = await import('@/lib/db');
      const { wallets: walletsTable } = await import('@/drizzle/schema');
      const { eq: eq2 } = await import('drizzle-orm');
      const [defaultWallet] = await getDb2()
        .select({ id: walletsTable.id })
        .from(walletsTable)
        .where(eq2(walletsTable.userId, userId))
        .limit(1);
      if (!defaultWallet) return { error: 'No wallet configured. Add a wallet first.' };
      const result = await createMintTaskFromUrl(
        String(input.url),
        defaultWallet.id,
        userId,
        input.quantity ? Number(input.quantity) : 1,
      );
      return { success: true, action: result.action, taskId: result.taskId, error: result.error };
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
            inArray(mintTasks.status, ['pending', 'monitoring', 'ready', 'running']),
          ),
        )
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
        .where(
          and(
            eq(mintTasks.id, String(input.taskId)),
            eq(mintTasks.userId, userId),
            inArray(mintTasks.status, ['pending', 'monitoring', 'ready']),
          ),
        )
        .returning({ id: mintTasks.id });
      if (!updated) return { success: false, error: 'Task not found or not cancellable' };
      return { success: true, cancelledTaskId: updated.id };
    }

    case 'get_watched_wallets': {
      const { getUserWatchedWallets } = await import('@/lib/services/wallet-tracker.service');
      const walletsList = await getUserWatchedWallets(userId);
      return { wallets: walletsList, count: walletsList.length };
    }

    case 'get_copy_mint_rules': {
      const { getCopyMintRules } = await import('@/lib/services/copy-mint.service');
      const rules = await getCopyMintRules(userId);
      return { rules, count: rules.length };
    }

    case 'get_wallet_balance': {
      const { getDb } = await import('@/lib/db');
      const { wallets } = await import('@/drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const chain = String(input.chain ?? 'ethereum') as 'ethereum' | 'base' | 'polygon' | 'arbitrum';
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
      return { address: wallet.address, balance: wallet.balance, symbol: wallet.balanceSymbol, chain: wallet.chain };
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return 'AI features are not configured. Set ANTHROPIC_API_KEY in your environment.\n\nUse slash commands instead:\n/mint <url> • /watch <address> • /status • /cancel • /settings';
  }

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: message }];

  addBreadcrumb({
    category: 'ai-interpreter',
    message: 'Starting AI interpretation',
    level: 'info',
    data: { userId, messageLength: message.length },
  });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      // If no tool calls, extract and return the text reply
      if (response.stop_reason !== 'tool_use') {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
        return text || 'Done.';
      }

      // Execute tool calls
      const toolBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolBlocks) {
        logger.info('AI tool call', {
          area: 'ai-interpreter',
          tool: block.name,
          input: block.input,
          userId,
        });

        try {
          const result = await executeTool(
            userId,
            block.name,
            block.input as Record<string, unknown>,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.warn('AI tool error', {
            area: 'ai-interpreter',
            tool: block.name,
            error: errMsg,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify({ error: errMsg }),
            is_error: true,
          });
        }
      }

      // Continue the conversation with tool results
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults });
    }

    return 'I completed your request. Check /status for details.';
  } catch (error) {
    await captureException(error, {
      area: 'ai-interpreter',
      context: { userId, messagePreview: message.slice(0, 100) },
      fingerprint: ['ai-interpreter', 'anthropic'],
    });
    throw error;
  }
}
