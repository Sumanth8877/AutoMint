import 'server-only';

import crypto from 'crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getWalletBalance, isValidEthereumAddress } from '@/lib/blockchain/wallet';
import { mintTasks, telegramAccounts, wallets } from '@/drizzle/schema';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { getMintState } from '@/lib/services/mint-state.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { handleMintUrl } from '@/lib/services/mint-orchestrator.service';
import { createWallet } from '@/lib/services/wallet.service';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_SEND_ATTEMPTS = 3;
const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

export type TelegramNotificationType =
  | 'mint_scheduled'
  | 'mint_started'
  | 'mint_success'
  | 'mint_failed'
  | 'high_risk_collection'
  | 'risk_analysis_complete'
  | 'wallet_balance_low'
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

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

type SendMessageResult = {
  message_id: number;
};

type SendMessageOptions = {
  disableWebPagePreview?: boolean;
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
  riskReason?: string;
  confidence?: number;
};

function getTelegramBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return token;
}

function getLinkSecret() {
  const secret = process.env.TELEGRAM_LINK_SECRET || process.env.CLERK_SECRET_KEY || process.env.TRIGGER_SECRET_KEY;
  if (!secret) throw new Error('TELEGRAM_LINK_SECRET, CLERK_SECRET_KEY, or TRIGGER_SECRET_KEY is required');
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
  return telegramRequest<SendMessageResult>('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: options.disableWebPagePreview ?? true,
  });
}

function signTokenPayload(encodedPayload: string) {
  return crypto.createHmac('sha256', getLinkSecret()).update(encodedPayload).digest('base64url');
}

export function createTelegramLinkToken(userId: string) {
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
  const [account] = await getDb()
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId))
    .limit(1);

  return account ?? null;
}

async function getTelegramAccountByTelegramId(telegramId: string) {
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
      lines.push('Mint Scheduled', truncate(subject));
      if (payload.taskId) lines.push(`Task: ${payload.taskId}`);
      break;
    case 'mint_started':
      lines.push('Mint Started', truncate(subject));
      if (payload.taskId) lines.push(`Task: ${payload.taskId}`);
      break;
    case 'mint_success':
      lines.push('Mint Success', truncate(subject));
      if (payload.txHash) lines.push(`Tx: ${payload.txHash}`);
      break;
    case 'mint_failed':
      lines.push('Mint Failed', truncate(subject));
      if (payload.error) lines.push(`Reason: ${payload.error}`);
      break;
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
    case 'copy_mint_triggered':
      lines.push('Copy Mint Triggered', truncate(subject));
      break;
  }

  return lines.join('\n');
}

export async function sendTelegramNotification(
  userId: string,
  type: TelegramNotificationType,
  payload: NotificationPayload = {},
) {
  try {
    const account = await getTelegramAccountByUserId(userId);
    if (!account) return { sent: false, reason: 'telegram_not_linked' };

    await sendTelegramMessage(account.chatId, formatNotification(type, payload));
    return { sent: true };
  } catch (error) {
    console.error('Telegram notification failed:', error);
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'telegram_notification_failed',
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

  await sendTelegramMessage(account.chatId, 'Telegram linked to AutoMint. Commands: /mint <url>, /schedule <url>, /watch <wallet>, /status, /cancel, /settings.');
}

async function handleMintCommand(message: TelegramMessage, userId: string, url: string) {
  if (!url) {
    await reply(message, 'Usage: /mint <url>');
    return;
  }

  const wallet = await loadDefaultWallet(userId);
  if (!wallet) {
    await reply(message, 'Add a wallet in AutoMint before triggering a mint from Telegram.');
    return;
  }

  await sendTelegramNotification(userId, 'copy_mint_triggered', { url });
  await sendTelegramNotification(userId, 'mint_started', { url });

  const result = await handleMintUrl(url, wallet.id, userId, 1);

  if (result.action === 'EXECUTED') {
    await sendTelegramNotification(userId, 'mint_success', { url, txHash: result.txHash, taskId: result.taskId });
    await reply(message, result.txHash ? `Mint executed.\nTx: ${result.txHash}` : 'Mint execution completed.');
    return;
  }

  if (result.action === 'SCHEDULED') {
    await sendTelegramNotification(userId, 'mint_scheduled', { url, taskId: result.taskId });
    await reply(message, `Mint scheduled.\nTask: ${result.taskId}`);
    return;
  }

  await sendTelegramNotification(userId, 'mint_failed', { url, error: result.error });
  await reply(message, `Mint failed: ${result.error || 'Unknown error'}`);
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

  const [task] = await getDb().insert(mintTasks).values({
    userId,
    walletId: wallet.id,
    quantity: 1,
    status: mintState.status === 'LIVE' ? 'ready' : 'pending',
    contractAddress: intent.contractAddress,
    mintFunction: requirements.mintFunction,
    mintPrice: requirements.mintPrice,
  }).returning();

  await sendTelegramNotification(userId, 'mint_scheduled', {
    url,
    taskId: task.id,
    contractAddress: intent.contractAddress,
  });
  await reply(message, `Mint scheduled.\nTask: ${task.id}`);
}

async function handleWatchCommand(message: TelegramMessage, userId: string, address: string) {
  if (!address || !isValidEthereumAddress(address)) {
    await reply(message, 'Usage: /watch <wallet>');
    return;
  }

  try {
    const wallet = await createWallet(userId, {
      address,
      nickname: `Telegram ${address.slice(0, 6)}...${address.slice(-4)}`,
      chain: 'ethereum',
    });
    const balance = await getWalletBalance(wallet.address, wallet.chain);

    await notifyWalletBalanceIfLow({
      userId,
      address: wallet.address,
      chain: wallet.chain,
      balance: balance.balance,
      symbol: balance.symbol,
    });

    await reply(message, `Wallet watch added.\n${wallet.address}\nBalance: ${balance.balance} ${balance.symbol}`);
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

  const [task] = await getDb()
    .update(mintTasks)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(mintTasks.id, target.id), eq(mintTasks.userId, userId)))
    .returning();

  if (!task) {
    await reply(message, 'No cancellable mint task found.');
    return;
  }

  await reply(message, `Cancelled mint task.\nTask: ${task.id}`);
}

async function handleSettingsCommand(message: TelegramMessage, account: { username: string | null; chatId: string }) {
  const username = account.username ? `@${account.username}` : 'not set';
  await reply(message, [
    'AutoMint Telegram Settings',
    `Username: ${username}`,
    `Chat ID: ${account.chatId}`,
    'Notifications: enabled',
    'Commands: /mint <url>, /schedule <url>, /watch <wallet>, /status, /cancel, /settings',
  ].join('\n'));
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message ?? update.edited_message;
  if (!message?.text) return { handled: false };

  const { command, rawArgs } = parseCommand(message.text);
  if (!command.startsWith('/')) return { handled: false };

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
      await reply(message, 'Unknown command. Use /settings to see available commands.');
      break;
  }

  return { handled: true };
}
