import 'server-only';

import crypto from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { parseMintShortcut, executeMintShortcut } from '@/lib/services/mint-shortcut.service';
import { parseWlShortcut, parseWlNaturalMessage, executeWlShortcut } from '@/lib/services/wl-shortcut.service';
import { getDb } from '@/lib/db';
import { getWalletBalance, isValidEthereumAddress } from '@/lib/blockchain/wallet';
import { mintTasks, telegramAccounts, wallets } from '@/drizzle/schema';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { getMintState } from '@/lib/services/mint-state.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { createMintTaskFromUrl, withMintTaskCreationLock } from '@/lib/services/mint-orchestrator.service';
import { cancelScheduledMint, scheduleMint } from '@/lib/services/qstash.service';
import { watchWallet } from '@/lib/services/wallet-tracker.service';
import { publishEvent } from '@/lib/services/event-bus.service';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_SEND_ATTEMPTS = 3;
const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

export type TelegramNotificationType =
  | 'mint_scheduled'
  | 'mint_created'      // new name for task creation
  | 'mint_started'
  | 'mint_executing'    // new name for execution start
  | 'mint_success'
  | 'mint_failed'
  | 'mint_live_detected'
  | 'high_risk_collection'
  | 'risk_analysis_complete'
  | 'wallet_balance_low'
  | 'wallet_minted_nft'
  | 'wallet_purchased_nft'
  | 'copy_mint_triggered';

type TelegramApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; description?: string; error_code?: number; parameters?: { retry_after?: number } };

type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramChat = {
  id: number;
  type: string;
};

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type SendMessageResult = {
  message_id: number;
  disabled?: boolean;
};

type InlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type SendMessageOptions = {
  disableWebPagePreview?: boolean;
  replyMarkup?: InlineKeyboardMarkup;
  // Telegram supports 'HTML', 'Markdown', 'MarkdownV2'. When set, `text`
  // must contain valid entities for the chosen mode or the API returns 400.
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
};

type NotificationPayload = {
  url?: string;
  wallet?: string;
  collectionName?: string;
  contractAddress?: string;
  taskId?: string;
  txHash?: string;
  error?: string;
  balance?: string;
  symbol?: string;
  mintPrice?: string;
  detail?: string;
  riskReason?: string;
  confidence?: number;
};

export function isTelegramEnabled() {
  return process.env.TELEGRAM_ENABLED?.trim().toLowerCase() === 'true';
}

function telegramDisabledResult(reason = 'telegram_disabled') {
  return { sent: true, skipped: true, disabled: true, reason };
}

type SafeModePromptParams = {
  userId: string;
  taskId: string;
  action: 'mint' | 'schedule';
  riskScore: number;
  riskReasons: string[];
};

type RiskChangePromptParams = {
  userId: string;
  taskId: string;
  previousScore: number;
  currentScore: number;
};

function getTelegramBotToken() {
  if (!isTelegramEnabled()) throw new Error('Telegram disabled by configuration');
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return token;
}

function getLinkSecret() {
  // M-3 fix: use a dedicated TELEGRAM_LINK_SECRET only.
  // The old code fell back to CLERK_SECRET_KEY which reuses the same key material
  // across two different security contexts (Clerk auth + Telegram HMAC).
  // Key reuse is a security anti-pattern — if one context is compromised the other
  // is too. TELEGRAM_LINK_SECRET must be a separate randomly-generated value.
  // Generate one with: openssl rand -hex 32
  if (!isTelegramEnabled()) return 'telegram-disabled';
  const secret = process.env.TELEGRAM_LINK_SECRET;
  if (!secret) throw new Error(
    'TELEGRAM_LINK_SECRET is required when Telegram is enabled. ' +
    'Generate a dedicated secret: openssl rand -hex 32'
  );
  return secret;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status: number | undefined) {
  return status === 429 || (status !== undefined && status >= 500);
}

async function telegramRequest<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const token = getTelegramBotToken();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => null) as TelegramApiResponse<T> | null;

      if (response.ok && body?.ok) {
        const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
        await trackAnalyticsEvent({
          eventType: 'telegram',
          status: 'success',
          provider: method,
          metadata: {
            chatId: typeof payload.chat_id === 'string' || typeof payload.chat_id === 'number' ? String(payload.chat_id) : undefined,
          },
        });
        return body.result;
      }

      const retryAfterMs = !body?.ok && body?.parameters?.retry_after
        ? body.parameters.retry_after * 1000
        : undefined;
      const description = body && !body.ok ? body.description : undefined;
      lastError = new Error(description || `Telegram ${method} failed with status ${response.status}`);

      if (attempt < MAX_SEND_ATTEMPTS && shouldRetry(response.status)) {
        await sleep(retryAfterMs ?? 250 * 2 ** (attempt - 1));
        continue;
      }

      throw lastError;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Telegram request failed');
      if (attempt === MAX_SEND_ATTEMPTS) {
        const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
        await trackAnalyticsEvent({
          eventType: 'telegram',
          status: 'failed',
          provider: method,
          metadata: {
            chatId: typeof payload.chat_id === 'string' || typeof payload.chat_id === 'number' ? String(payload.chat_id) : undefined,
            error: lastError.message,
          },
        });
      }
      if (attempt < MAX_SEND_ATTEMPTS) {
        await sleep(250 * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error('Telegram request failed');
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: SendMessageOptions = {},
) {
  if (!isTelegramEnabled()) {
    return { message_id: 0, disabled: true };
  }

  return telegramRequest<SendMessageResult>('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
    reply_markup: options.replyMarkup,
    parse_mode: options.parseMode,
  });
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  if (!isTelegramEnabled()) return true;

  return telegramRequest<boolean>('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  });
}

function signTokenPayload(encodedPayload: string) {
  return crypto.createHmac('sha256', getLinkSecret()).update(encodedPayload).digest('base64url');
}

export function createTelegramLinkToken(userId: string) {
  if (!isTelegramEnabled()) return '';

  const payload = {
    userId,
    exp: Date.now() + LINK_TOKEN_TTL_MS,
    nonce: crypto.randomBytes(12).toString('base64url'),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${signTokenPayload(encodedPayload)}`;
}

function verifyTelegramLinkToken(token: string) {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) throw new Error('Invalid link token');

  const expected = signTokenPayload(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid link token');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
    userId?: string;
    exp?: number;
  };

  if (!payload.userId || !payload.exp || payload.exp < Date.now()) {
    throw new Error('Link token expired');
  }

  return payload.userId;
}

export async function linkTelegramAccount(params: {
  token: string;
  telegramId: string;
  username?: string | null;
  chatId: string;
}) {
  if (!isTelegramEnabled()) {
    return {
      id: 'telegram-disabled',
      userId: '',
      telegramId: params.telegramId,
      username: params.username || null,
      chatId: params.chatId,
      createdAt: new Date(),
    };
  }

  const userId = verifyTelegramLinkToken(params.token);

  const [account] = await getDb()
    .insert(telegramAccounts)
    .values({
      userId,
      telegramId: params.telegramId,
      username: params.username || null,
      chatId: params.chatId,
    })
    .onConflictDoUpdate({
      target: telegramAccounts.telegramId,
      set: {
        userId,
        username: params.username || null,
        chatId: params.chatId,
      },
    })
    .returning();

  return account;
}

export async function getTelegramAccountByUserId(userId: string) {
  if (!isTelegramEnabled()) return null;

  const [account] = await getDb()
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId))
    .limit(1);

  return account ?? null;
}

async function getTelegramAccountByTelegramId(telegramId: string) {
  if (!isTelegramEnabled()) return null;

  const [account] = await getDb()
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.telegramId, telegramId))
    .limit(1);

  return account ?? null;
}

function truncate(value: string, length = 42) {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function formatNotification(type: TelegramNotificationType, payload: NotificationPayload) {
  const subject = payload.collectionName || payload.contractAddress || payload.url || payload.wallet || 'AutoMint';
  const lines: string[] = [];

  switch (type) {
    case 'mint_scheduled':
      lines.push('🕐 Mint Scheduled', truncate(subject));
      if (payload.taskId) lines.push(`Task: ${payload.taskId.slice(0, 8)}`);
      break;
    case 'mint_started':
    case 'mint_executing':
      lines.push('⚡ Mint Executing', truncate(subject));
      if (payload.mintPrice) lines.push(`Price: ${payload.mintPrice} ETH`);
      if (payload.taskId) lines.push(`Task: ${payload.taskId.slice(0, 8)}`);
      break;
    case 'mint_success':
      lines.push('✅ Mint Success', truncate(subject));
      if (payload.mintPrice) lines.push(`Price: ${payload.mintPrice} ETH`);
      if (payload.txHash) lines.push(`Tx: ${payload.txHash.slice(0, 18)}...`);
      break;
    case 'mint_live_detected':
      lines.push('🚀 Mint Is Live — Executing Now', truncate(subject));
      if (payload.contractAddress) lines.push(`Contract: ${String(payload.contractAddress).slice(0, 10)}...`);
      break;
    case 'mint_failed': {
      const errMsg = payload.error ?? '';
      const errLow = errMsg.toLowerCase();
      let errLabel: string;
      if (errLow.includes('insufficient funds') || errLow.includes('insufficient balance')) {
        errLabel = '💸 Insufficient funds';
      } else if (errLow.includes('balance') || errLow.includes('too low')) {
        errLabel = '💸 Balance too low';
      } else if (errLow.includes('reverted') || errLow.includes('execution reverted')) {
        errLabel = '🔁 Contract reverted';
      } else if (errLow.includes('nonce') || errLow.includes('replacement transaction')) {
        errLabel = '🔄 Nonce conflict';
      } else if (errLow.includes('gas') || errLow.includes('intrinsic')) {
        errLabel = '⛽ Gas estimation failed';
      } else if (errLow.includes('timeout') || errLow.includes('timed out')) {
        errLabel = '⏱ Execution timed out';
      } else if (errMsg) {
        errLabel = errMsg.slice(0, 60);
      } else {
        errLabel = 'Unknown error';
      }
      lines.push('❌ Mint Failed', truncate(subject));
      lines.push(`Reason: ${errLabel}`);
      if (payload.mintPrice) lines.push(`Price: ${payload.mintPrice} ETH`);
      if (payload.detail) lines.push(payload.detail);
      break;
    }
    case 'high_risk_collection':
      lines.push('High Risk Collection', truncate(subject));
      if (payload.riskReason) lines.push(`Reason: ${payload.riskReason}`);
      break;
    case 'risk_analysis_complete':
      lines.push('Risk Analysis Complete', truncate(subject));
      if (payload.confidence !== undefined) lines.push(`Confidence: ${Math.round(payload.confidence * 100)}%`);
      break;
    case 'wallet_balance_low':
      lines.push('Wallet Balance Low', truncate(subject));
      if (payload.balance && payload.symbol) lines.push(`Balance: ${payload.balance} ${payload.symbol}`);
      break;
    case 'wallet_minted_nft':
      lines.push('Wallet Minted NFT', truncate(subject));
      if (payload.txHash) lines.push(`Tx: ${payload.txHash}`);
      break;
    case 'wallet_purchased_nft':
      lines.push('Wallet Purchased NFT', truncate(subject));
      if (payload.txHash) lines.push(`Tx: ${payload.txHash}`);
      break;
    case 'copy_mint_triggered':
      lines.push('Copy Mint Triggered', truncate(subject));
      break;
  }

  return lines.join('\n');
}

// Issue 2 Fix: Only send Telegram notifications for mint lifecycle events.
// Analysis, risk, and wallet-tracker events are silently dropped.
const MINT_NOTIFICATION_TYPES: ReadonlySet<TelegramNotificationType> = new Set([
  'mint_scheduled',     // task created (alias for mint_created)
  'mint_created',
  'mint_executing',     // execution started
  'mint_started',       // legacy alias for executing
  'mint_success',
  'mint_failed',
  'mint_live_detected',
]);

export async function sendTelegramNotification(
  userId: string,
  type: TelegramNotificationType,
  payload: NotificationPayload = {},
) {
  if (!isTelegramEnabled()) return telegramDisabledResult();

  // Only mint lifecycle notifications are sent — analysis/risk/wallet noise is filtered out
  if (!MINT_NOTIFICATION_TYPES.has(type)) {
    return { sent: false, reason: 'notification_type_filtered' };
  }

  try {
    const account = await getTelegramAccountByUserId(userId);
    if (!account) return { sent: false, reason: 'telegram_not_linked' };

    // For scheduled mints, attach an inline keyboard so the user can cancel
    // directly from their phone without opening the web app.
    const replyMarkup: InlineKeyboardMarkup | undefined =
      type === 'mint_scheduled' && payload.taskId
        ? {
            inline_keyboard: [[
              { text: '❌ Cancel Task', callback_data: `schedule:cancel:${payload.taskId}` },
            ]],
          }
        : undefined;

    await sendTelegramMessage(account.chatId, formatNotification(type, payload), {
      replyMarkup,
    });
    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'telegram_notification_failed',
    };
  }
}

export async function sendTelegramSafeModePrompt(params: SafeModePromptParams) {
  if (!isTelegramEnabled()) return telegramDisabledResult('approval_channel_unavailable');

  try {
    const account = await getTelegramAccountByUserId(params.userId);
    if (!account) return { sent: false, reason: 'telegram_not_linked' };

    const primaryLabel = params.action === 'schedule' ? 'Schedule Anyway' : 'Mint Anyway';
    const primaryAction = params.action === 'schedule' ? 'schedule_anyway' : 'mint_anyway';
    const reasons = params.riskReasons.slice(0, 5).map((reason) => `- ${reason}`).join('\n');

    await sendTelegramMessage(account.chatId, [
      params.action === 'schedule' ? 'High Risk Scheduled Mint' : 'High Risk Live Mint',
      `Risk Score: ${params.riskScore}/100`,
      reasons || 'No specific risk reasons available.',
    ].join('\n'), {
      replyMarkup: {
        inline_keyboard: [[
          { text: primaryLabel, callback_data: `risk:${primaryAction}:${params.taskId}` },
          { text: 'Cancel', callback_data: `risk:cancel:${params.taskId}` },
        ]],
      },
    });

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'telegram_safe_mode_prompt_failed',
    };
  }
}

export async function sendTelegramRiskChangePrompt(params: RiskChangePromptParams) {
  if (!isTelegramEnabled()) return telegramDisabledResult('approval_channel_unavailable');

  try {
    const account = await getTelegramAccountByUserId(params.userId);
    if (!account) return { sent: false, reason: 'telegram_not_linked' };

    await sendTelegramMessage(account.chatId, [
      'Risk Score Changed',
      `Previous: ${params.previousScore}`,
      `Current: ${params.currentScore}`,
    ].join('\n'), {
      replyMarkup: {
        inline_keyboard: [[
          { text: 'Mint Anyway', callback_data: `risk:approve_mint:${params.taskId}` },
          { text: 'Cancel', callback_data: `risk:cancel:${params.taskId}` },
        ]],
      },
    });

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'telegram_risk_change_prompt_failed',
    };
  }
}

export async function notifyWalletBalanceIfLow(params: {
  userId: string;
  address: string;
  chain: string;
  balance: string;
  symbol: string;
}) {
  if (!isTelegramEnabled()) return telegramDisabledResult();

  const threshold = Number(process.env.TELEGRAM_LOW_BALANCE_THRESHOLD ?? '0.01');
  const value = Number(params.balance);

  if (!Number.isFinite(value) || value >= threshold) {
    return { sent: false, reason: 'balance_above_threshold' };
  }

  return sendTelegramNotification(params.userId, 'wallet_balance_low', {
    wallet: `${params.address} on ${params.chain}`,
    balance: params.balance,
    symbol: params.symbol,
  });
}

function parseCommand(text: string) {
  const trimmed = text.trim();
  const [rawCommand = '', ...parts] = trimmed.split(/\s+/);
  const command = rawCommand.split('@')[0].toLowerCase();
  return {
    command,
    args: parts,
    rawArgs: trimmed.slice(rawCommand.length).trim(),
  };
}

async function loadDefaultWallet(userId: string) {
  const [wallet] = await getDb()
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .orderBy(wallets.createdAt)
    .limit(1);

  return wallet ?? null;
}

async function reply(message: TelegramMessage, text: string) {
  await sendTelegramMessage(String(message.chat.id), text);
}

function accountRequiredText() {
  return 'Telegram is not linked yet. Open AutoMint settings, generate a Telegram link token, then send /start <token> here.';
}

async function handleStart(message: TelegramMessage, token: string) {
  if (!message.from) {
    await reply(message, 'Unable to link Telegram without a Telegram user ID.');
    return;
  }

  if (!token) {
    await reply(message, accountRequiredText());
    return;
  }

  const account = await linkTelegramAccount({
    token,
    telegramId: String(message.from.id),
    username: message.from.username || null,
    chatId: String(message.chat.id),
  });

  await sendTelegramMessage(
    account.chatId,
    '✅ *Telegram linked to your AutoMint account!*\n\n' +
    'You can now control your full AutoMint platform from here.\n\n' +
    '*Quick commands:*\n' +
    '⚡ Just paste a URL to mint instantly\n' +
    '/mint <url> [qty] — queue a mint\n' +
    '/watch <wallet> — track a whale\n' +
    '/status — active mints\n' +
    '/cancel — cancel latest mint\n' +
    '/settings — view settings\n' +
    '/model — change AI model\n\n' +
    'Or just type anything in plain English — the AI handles it 🤖',
  );
}

const MAX_MINT_QUANTITY = 50;

/** Parse "url" or "url qty" — supports /mint url qty and bare "url qty" */
function parseMintInput(rawInput: string): { url: string; quantity: number } | { error: string } {
  const parts = rawInput.trim().split(/\s+/);
  const lastPart = parts[parts.length - 1] ?? '';

  if (parts.length > 1 && /^\d+$/.test(lastPart)) {
    const qty = parseInt(lastPart, 10);
    if (qty < 1) return { error: '❌ Quantity must be at least 1.' };
    if (qty > MAX_MINT_QUANTITY) {
      return { error: `❌ Quantity ${qty} exceeds the maximum of ${MAX_MINT_QUANTITY} NFTs per mint.\n\nTry a number between 1–${MAX_MINT_QUANTITY}.` };
    }
    return { url: parts.slice(0, -1).join(' '), quantity: qty };
  }

  return { url: rawInput.trim(), quantity: 1 };
}

async function handleMintCommand(message: TelegramMessage, userId: string, rawInput: string) {
  if (!rawInput) {
    await reply(message, `Usage: /mint <url> [quantity]\n\nExamples:\n  /mint https://... 1 (default)\n  /mint https://... 5\n  https://... 3 (bare URL)\n\nMax: ${MAX_MINT_QUANTITY} NFTs per mint`);
    return;
  }

  const wallet = await loadDefaultWallet(userId);
  if (!wallet) {
    await reply(message, 'Add a wallet in AutoMint before triggering a mint from Telegram.');
    return;
  }

  // C-04 Fix: create a task and schedule via QStash — never execute inline.
  // The webhook returns immediately. All blockchain execution happens in the
  // QStash → /api/webhooks/qstash → executeScheduledMint pipeline.
  const parsed = parseMintInput(rawInput);
  if ('error' in parsed) { await reply(message, parsed.error); return; }
  const { url, quantity } = parsed;

  // C-04 Fix: create a task and schedule via QStash — never execute inline.
  const result = await createMintTaskFromUrl(url, wallet.id, userId, quantity);
  const qtyLabel = `${quantity} NFT${quantity > 1 ? 's' : ''}`;

  if (result.action === 'FAILED') {
    await sendTelegramNotification(userId, 'mint_failed', { url, error: result.error });
    await reply(message, `❌ Mint failed: ${result.error || 'Unknown error'}`);
    return;
  }

  if (result.action === 'MONITORING') {
    await sendTelegramNotification(userId, 'mint_created', { url, taskId: result.taskId });
    void publishEvent(userId, 'mint:created', { taskId: result.taskId, url });
    await reply(
      message,
      `⏳ Monitoring started.\nTask: ${result.taskId}\nQty: ${qtyLabel}\nYou'll be notified when the mint goes live.`,
    );
    return;
  }

  // TASK_CREATED: mint is live — task queued for near-immediate execution via QStash.
  await sendTelegramNotification(userId, 'mint_created', { url, taskId: result.taskId });
  void publishEvent(userId, 'mint:created', { taskId: result.taskId, url });
  await reply(
    message,
    `✅ Mint task created.\nTask: ${result.taskId}\nQty: ${qtyLabel}\nExecution starting shortly — you'll be notified on completion.`,
  );
}

async function handleScheduleCommand(message: TelegramMessage, userId: string, url: string) {
  if (!url) {
    await reply(message, 'Usage: /schedule <url>');
    return;
  }

  const wallet = await loadDefaultWallet(userId);
  if (!wallet) {
    await reply(message, 'Add a wallet in AutoMint before scheduling a mint from Telegram.');
    return;
  }

  const normalizedInput = url.startsWith('0x') ? `https://etherscan.io/address/${url}` : url;
  const intent = await resolveMintIntent(normalizedInput);
  if (!intent.contractAddress) {
    await reply(message, 'Could not resolve a contract address from that URL.');
    return;
  }

  const [mintState, requirements] = await Promise.all([
    getMintState(intent.contractAddress, intent.chain),
    fetchMintRequirements(intent.contractAddress, intent.chain),
  ]);

  if (mintState.status === 'ENDED') {
    await sendTelegramNotification(userId, 'mint_failed', { url, error: 'Mint has already ended' });
    await reply(message, 'This mint has already ended.');
    return;
  }

  // C3 fix: the /schedule command previously inserted with no dedup at all —
  // two quick /schedule commands for the same URL created two tasks and minted
  // twice. Serialize the check-then-insert per (user, contract) and return the
  // existing active task if one already exists for this wallet.
  const contractAddress = intent.contractAddress;
  const task = await withMintTaskCreationLock(userId, contractAddress, async () => {
    const [existing] = await getDb()
      .select()
      .from(mintTasks)
      .where(and(
        eq(mintTasks.userId, userId),
        eq(mintTasks.walletId, wallet.id),
        eq(mintTasks.contractAddress, contractAddress),
        inArray(mintTasks.status, ['pending', 'monitoring', 'ready', 'running', 'unconfirmed']),
      ))
      .limit(1);
    if (existing) return existing;

    const [created] = await getDb().insert(mintTasks).values({
      userId,
      walletId: wallet.id,
      quantity: 1,
      status: mintState.status === 'LIVE' ? 'ready' : 'pending',
      contractAddress,
      mintFunction: requirements.mintFunction,
      mintPrice: requirements.mintPrice,
    }).returning();
    return created;
  });

  if (mintState.status !== 'LIVE') {
    const scheduledTime = mintState.startTime && mintState.startTime.getTime() > Date.now()
      ? mintState.startTime
      : undefined;
    const scheduledTask = await scheduleMint({ taskId: task.id, userId, scheduledTime });
    if (!scheduledTask.qstashMessageId) {
      await reply(message, `Risk approval requested.\nTask: ${scheduledTask.id}`);
      return;
    }
    await reply(message, `Mint scheduled.\nTask: ${scheduledTask.id}`);
    return;
  }

  const { requireRiskApproval } = await import('@/lib/services/risk.service');
  const riskGate = await requireRiskApproval({ taskId: task.id, action: 'mint', userId });
  if (!riskGate.approved) {
    await reply(message, `Risk approval requested.\nTask: ${task.id}`);
    return;
  }

  await sendTelegramNotification(userId, 'mint_created', {
    url,
    taskId: task.id,
    contractAddress: intent.contractAddress,
  });
  await reply(message, `Mint is live and ready.\nTask: ${task.id}`);
}

async function handleWatchCommand(message: TelegramMessage, userId: string, address: string) {
  if (!address || !isValidEthereumAddress(address)) {
    await reply(message, 'Usage: /watch <wallet>');
    return;
  }

  try {
    const wallet = await watchWallet(userId, {
      walletAddress: address,
      chain: 'ethereum',
    });
    const balance = await getWalletBalance(wallet.walletAddress, wallet.chain);

    await notifyWalletBalanceIfLow({
      userId,
      address: wallet.walletAddress,
      chain: wallet.chain,
      balance: balance.balance,
      symbol: balance.symbol,
    });

    void publishEvent(userId, 'watched-wallet:created', { address: wallet.walletAddress });
    await reply(message, `Wallet tracker enabled.\n${wallet.walletAddress}\nChain: ${wallet.chain}\nStatus: ${wallet.active ? 'active' : 'inactive'}\nBalance: ${balance.balance} ${balance.symbol}`);
  } catch (error) {
    await reply(message, error instanceof Error ? error.message : 'Failed to watch wallet.');
  }
}

async function handleStatusCommand(message: TelegramMessage, userId: string) {
  const rows = await getDb()
    .select()
    .from(mintTasks)
    .where(eq(mintTasks.userId, userId))
    .orderBy(desc(mintTasks.createdAt))
    .limit(10);

  if (rows.length === 0) {
    await reply(message, 'No mint tasks yet.');
    return;
  }

  const counts = rows.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});

  const latest = rows[0];
  const lines = [
    'AutoMint Status',
    ...Object.entries(counts).map(([status, count]) => `${status}: ${count}`),
    `Latest: ${latest.status} ${latest.contractAddress ? truncate(latest.contractAddress, 18) : latest.id}`,
  ];

  await reply(message, lines.join('\n'));
}

async function handleCancelCommand(message: TelegramMessage, userId: string) {
  const [target] = await getDb()
    .select({ id: mintTasks.id })
    .from(mintTasks)
    .where(and(
      eq(mintTasks.userId, userId),
      inArray(mintTasks.status, ['pending', 'monitoring', 'ready', 'running']),
    ))
    .orderBy(desc(mintTasks.createdAt))
    .limit(1);

  if (!target) {
    await reply(message, 'No cancellable mint task found.');
    return;
  }

  const task = await cancelScheduledMint(target.id, userId);

  void publishEvent(userId, 'mint:cancelled', { taskId: task.id });
  await reply(message, `Cancelled mint task.\nTask: ${task.id}`);
}

async function handleSettingsCommand(message: TelegramMessage, account: { username: string | null; chatId: string }) {
  const username = account.username ? `@${account.username}` : 'not set';
  await reply(message, [
    'AutoMint Telegram Settings',
    `Username: ${username}`,
    `Chat ID: ${account.chatId}`,
    'Notifications: enabled',
    'Commands: /mint <url>, /schedule <url>, /watch <wallet>, /status, /cancel, /settings, /model',
  ].join('\n'));
}

async function handleModelCommand(message: TelegramMessage, userId: string) {
  const { AVAILABLE_MODELS, getUserModel } = await import('@/lib/services/ai-interpreter.service');
  const current = await getUserModel(userId);
  const currentInfo = AVAILABLE_MODELS.find(m => m.id === current);

  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: AVAILABLE_MODELS.map(m => [{
      text: m.id === current ? `✅ ${m.label}` : m.label,
      callback_data: `model:select:${m.id}`,
    }]),
  };

  if (!message.chat?.id) return;
  await sendTelegramMessage(
    String(message.chat.id),
    [
      '🤖 *AI Model Selection*',
      '',
      `Current: *${currentInfo?.label ?? current}*`,
      `${currentInfo?.description ?? ''}`,
      '',
      'Tap a model to switch:',
    ].join('\n'),
    { replyMarkup: keyboard },
  );
}

async function handleModelCallback(callback: TelegramCallbackQuery) {
  const [scope, action, ...rest] = (callback.data || '').split(':');
  if (scope !== 'model' || action !== 'select') return { handled: false };

  const modelId = rest.join(':');
  const { AVAILABLE_MODELS, setUserModel } = await import('@/lib/services/ai-interpreter.service');

  const modelInfo = AVAILABLE_MODELS.find(m => m.id === modelId);
  if (!modelInfo) {
    await answerCallbackQuery(callback.id, '❌ Unknown model');
    return { handled: true };
  }

  const account = await getTelegramAccountByTelegramId(String(callback.from.id));
  if (!account) {
    await answerCallbackQuery(callback.id, 'Telegram is not linked.');
    return { handled: true };
  }

  await setUserModel(account.userId, modelInfo.id);

  // Update the keyboard so the newly selected model gets a ✅
  const current = modelInfo.id;
  const updatedKeyboard: InlineKeyboardMarkup = {
    inline_keyboard: AVAILABLE_MODELS.map(m => [{
      text: m.id === current ? `✅ ${m.label}` : m.label,
      callback_data: `model:select:${m.id}`,
    }]),
  };

  try {
    await telegramRequest('editMessageReplyMarkup', {
      chat_id: account.chatId,
      message_id: callback.message?.message_id,
      reply_markup: updatedKeyboard,
    });
  } catch {
    // Non-fatal if message edit fails (e.g. message too old)
  }

  await answerCallbackQuery(callback.id, `✅ Switched to ${modelInfo.label}`);
  return { handled: true };
}

async function handleRiskCallback(callback: TelegramCallbackQuery) {
  try {
  const [scope, action, taskId] = (callback.data || '').split(':');
  if (scope !== 'risk' || !action || !taskId) {
    return { handled: false };
  }

  const account = await getTelegramAccountByTelegramId(String(callback.from.id));
  if (!account) {
    await answerCallbackQuery(callback.id, 'Telegram is not linked.');
    return { handled: true };
  }

  if (action === 'cancel') {
    const { cancelScheduledMint } = await import('@/lib/services/qstash.service');
    await cancelScheduledMint(taskId, account.userId);
    await answerCallbackQuery(callback.id, 'Cancelled.');
    await sendTelegramMessage(account.chatId, `Cancelled mint task.\nTask: ${taskId}`);
    return { handled: true };
  }

  if (action === 'schedule_anyway') {
    const { scheduleMint } = await import('@/lib/services/qstash.service');
    await scheduleMint({ taskId, userId: account.userId, overrideRiskFlag: true });
    await answerCallbackQuery(callback.id, 'Scheduled.');
    await sendTelegramMessage(account.chatId, `Scheduled mint task.\nTask: ${taskId}`);
    return { handled: true };
  }

  if (action === 'mint_anyway') {
    const { getDb } = await import('@/lib/db');
    const { mintTasks } = await import('@/drizzle/schema');
    const { eq, and } = await import('drizzle-orm');
    const { executeMintTask } = await import('@/lib/services/mint.service');

    await getDb()
      .update(mintTasks)
      .set({ overrideRiskFlag: true, updatedAt: new Date() })
      .where(and(eq(mintTasks.id, taskId), eq(mintTasks.userId, account.userId)));

    const result = await executeMintTask(taskId, account.userId);
    await answerCallbackQuery(callback.id, result.success ? 'Mint started.' : 'Mint failed.');
    await sendTelegramMessage(
      account.chatId,
      result.success
        ? `Mint approved.\nTask: ${taskId}${result.txHash ? `\nTx: ${result.txHash}` : ''}`
        : `Mint failed.\nTask: ${taskId}\nReason: ${result.error || 'Unknown error'}`,
    );
    return { handled: true };
  }

  if (action === 'approve_mint') {
    const { getDb } = await import('@/lib/db');
    const { mintTasks } = await import('@/drizzle/schema');
    const { eq, and } = await import('drizzle-orm');

    await getDb()
      .update(mintTasks)
      .set({ overrideRiskFlag: true, safeModeEnabled: false, updatedAt: new Date() })
      .where(and(eq(mintTasks.id, taskId), eq(mintTasks.userId, account.userId)));

    await answerCallbackQuery(callback.id, 'Approved.');
    await sendTelegramMessage(account.chatId, `Scheduled mint approved.\nTask: ${taskId}`);
    return { handled: true };
  }

  await answerCallbackQuery(callback.id);
  return { handled: false };
  } catch (error) {
    throw error;
  }
}

async function handleScheduledMintCallback(callback: TelegramCallbackQuery) {
  try {
    const [scope, action, taskId] = (callback.data || '').split(':');
    if (scope !== 'schedule' || !action || !taskId) {
      return { handled: false };
    }

    const account = await getTelegramAccountByTelegramId(String(callback.from.id));
    if (!account) {
      await answerCallbackQuery(callback.id, 'Telegram is not linked to AutoMint.');
      return { handled: true };
    }

    if (action === 'cancel') {
      try {
        const { cancelScheduledMint } = await import('@/lib/services/qstash.service');
        const task = await cancelScheduledMint(taskId, account.userId);
        await answerCallbackQuery(callback.id, '✅ Task cancelled');
        await sendTelegramMessage(
          account.chatId,
          `❌ Mint task cancelled from Telegram.\nTask: ${task.id.slice(0, 8)}`,
        );
      } catch (cancelError) {
        const msg = cancelError instanceof Error ? cancelError.message : 'Cancel failed';
        await answerCallbackQuery(callback.id, `Failed: ${msg.slice(0, 50)}`);
        await sendTelegramMessage(
          account.chatId,
          `Could not cancel task ${taskId.slice(0, 8)}: ${msg.slice(0, 120)}`,
        );
      }
      return { handled: true };
    }

    await answerCallbackQuery(callback.id);
    return { handled: false };
  } catch (error) {
    throw error;
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (!isTelegramEnabled()) return { handled: false, disabled: true };

  if (update.callback_query?.data) {
    // Model selection callback
    const modelResult = await handleModelCallback(update.callback_query);
    if (modelResult.handled) return modelResult;
    // Check schedule:cancel callbacks first (highest priority — user-initiated cancel)
    const scheduleResult = await handleScheduledMintCallback(update.callback_query);
    if (scheduleResult.handled) return scheduleResult;
    // Then risk approval/cancel callbacks
    const riskResult = await handleRiskCallback(update.callback_query);
    if (riskResult.handled) return riskResult;
    return { handled: false };
  }

  const message = update.message ?? update.edited_message;
  if (!message?.text) return { handled: false };

  const { command, rawArgs } = parseCommand(message.text);

  // Bug #1 Fix: Plain text message (no '/' prefix).
  // If the user pasted a raw URL, treat it as /mint <url> so they don't
  // need to know the command syntax. Any other plain text gets a helpful
  // hint rather than being silently dropped.
  if (!command.startsWith('/')) {
    const text = message.text?.trim() ?? '';

    if (text.startsWith('http://') || text.startsWith('https://')) {
      // Route URLs through AI interpreter so event-bus publishes to web UI.
      if (!message.from) {
        await reply(message, 'Unable to process message without a Telegram user ID.');
        return { handled: true };
      }
      const urlAccount = await getTelegramAccountByTelegramId(String(message.from.id));
      if (!urlAccount) {
        await reply(message, accountRequiredText());
        return { handled: true };
      }
      try {
        // Check if it's a direct mint shortcut first — skip AI entirely
        const urlShortcut = parseMintShortcut(text);
        if (urlShortcut) {
          const shortcutReply = await executeMintShortcut(urlShortcut, urlAccount.userId);
          await reply(message, shortcutReply);
          return { handled: true };
        }
        const { interpretTelegramMessage } = await import('@/lib/services/ai-interpreter.service');
        const aiReply = await interpretTelegramMessage(`mint ${text}`, urlAccount.userId);
        await reply(message, aiReply);
      } catch {
        // Fallback to direct handler if AI fails
        await handleMintCommand(message, urlAccount.userId, text);
      }
      return { handled: true };
    }

    // Non-URL, non-command text — route to AI interpreter.
    if (!message.from) {
      await reply(message, 'Unable to process message without a Telegram user ID.');
      return { handled: true };
    }
    {
      const aiAccount = await getTelegramAccountByTelegramId(String(message.from.id));
      if (!aiAccount) {
        await reply(message, accountRequiredText());
        return { handled: true };
      }
      try {
        // WL natural-language fast-path: bare "@handle", "track @handle",
        // "watch @handle wallet 0x…" and friends bypass the AI entirely.
        // Runs BEFORE the mint shortcut so a mention like "@foo track it"
        // never gets misclassified as a mint intent.
        const wlNat = parseWlNaturalMessage(text);
        if (wlNat) {
          const wlReply = await executeWlShortcut(wlNat, aiAccount.userId);
          await sendTelegramMessage(String(message.chat.id), wlReply, {
            parseMode: 'HTML',
            disableWebPagePreview: true,
          });
          return { handled: true };
        }

        // Check for direct mint shortcut first — bypass AI entirely
        const aiShortcut = parseMintShortcut(text);
        if (aiShortcut) {
          const shortcutReply = await executeMintShortcut(aiShortcut, aiAccount.userId);
          await reply(message, shortcutReply);
          return { handled: true };
        }
        const { interpretTelegramMessage } = await import('@/lib/services/ai-interpreter.service');
        const aiReply = await interpretTelegramMessage(text, aiAccount.userId);
        await reply(message, aiReply);
      } catch (_aiError) {
        await reply(
          message,
          'AI processing failed. Try a slash command:\n/mint <url> • /watch <address> • /status • /cancel • /settings',
        );
      }
    }
    return { handled: true };
  }

  if (command === '/start') {
    await handleStart(message, rawArgs);
    return { handled: true };
  }

  if (!message.from) {
    await reply(message, 'Unable to process command without a Telegram user ID.');
    return { handled: true };
  }

  const account = await getTelegramAccountByTelegramId(String(message.from.id));
  if (!account) {
    await reply(message, accountRequiredText());
    return { handled: true };
  }

  // /model is Telegram-UI-only (inline keyboard) — keep it native.
  if (command === '/model') {
    await handleModelCommand(message, account.userId);
    return { handled: true };
  }

  // ── Route ALL other commands through the AI interpreter ──────────────
  // The AI has equivalent tools for every slash command (/mint, /watch,
  // /status, /cancel, /settings, /schedule, etc.) and can handle them
  // with richer context, multi-step reasoning, and real-time event
  // publishing to sync the web UI. Slash command text is passed as-is
  // so the AI sees the user's original intent.
  try {
    // WL tracker shortcut fast-path: /track /untrack /projects /checkins /done.
    // These bypass the AI entirely so they still work if the user has no
    // AI provider configured yet.
    const wlShortcut = parseWlShortcut(message.text ?? '');
    if (wlShortcut) {
      const wlReply = await executeWlShortcut(wlShortcut, account.userId);
      // WL replies use HTML formatting (project name in <b>, wallet in <code>).
      await sendTelegramMessage(String(message.chat.id), wlReply, {
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
      return { handled: true };
    }

    // Check for direct mint shortcut — bypass AI interpreter entirely
    const shortcut = parseMintShortcut(message.text ?? '');
    if (shortcut) {
      const shortcutReply = await executeMintShortcut(shortcut, account.userId);
      await reply(message, shortcutReply);
      return { handled: true };
    }
    const { interpretTelegramMessage } = await import('@/lib/services/ai-interpreter.service');
    const aiReply = await interpretTelegramMessage(message.text ?? '', account.userId);
    await reply(message, aiReply);
  } catch (_aiError) {
    // Fallback: if AI fails, try the legacy slash command handler
    logger.warn('AI interpreter failed, falling back to slash handler', { area: 'telegram', command });
    switch (command) {
      case '/mint':
        await handleMintCommand(message, account.userId, rawArgs);
        break;
      case '/schedule':
        await handleScheduleCommand(message, account.userId, rawArgs);
        break;
      case '/watch':
        await handleWatchCommand(message, account.userId, rawArgs);
        break;
      case '/status':
        await handleStatusCommand(message, account.userId);
        break;
      case '/cancel':
        await handleCancelCommand(message, account.userId);
        break;
      case '/settings':
        await handleSettingsCommand(message, account);
        break;
      default:
        await reply(message, 'AI processing failed. Try again or use /settings for help.');
        break;
    }
  }

  return { handled: true };
}
