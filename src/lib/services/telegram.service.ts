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
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
};

type ReplyKeyboardMarkup = {
  keyboard: Array<Array<{ text: string }>>;
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  selective?: boolean;
};

type SendMessageOptions = {
  disableWebPagePreview?: boolean;
  replyMarkup?: InlineKeyboardMarkup | ReplyKeyboardMarkup;
  // Telegram supports 'HTML', 'Markdown', 'MarkdownV2'. When set, `text`
  // must contain valid entities for the chosen mode or the API returns 400.
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
};

// ── Persistent quick-action keyboard shown below the chat input ──────────────
const QUICK_KEYBOARD: ReplyKeyboardMarkup = {
  keyboard: [
    [{ text: '⚡ Quick Mint' }, { text: '📊 Status' }],
    [{ text: '👁 Watch Whale' }, { text: '🛑 Cancel' }],
    [{ text: '⚙️ Settings' }, { text: '❓ Help' }],
  ],
  resize_keyboard: true,
};

// ── HTML helpers ─────────────────────────────────────────────────────────────
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shortAddr(addr: string, head = 6, tail = 4): string {
  if (addr.length <= head + tail + 2) return escapeHtml(addr);
  return `<code>${escapeHtml(addr.slice(0, head))}…${escapeHtml(addr.slice(-tail))}</code>`;
}

function shortId(id: string): string {
  return `<code>${escapeHtml(id.slice(0, 8))}</code>`;
}

function explorerTxLink(txHash: string, chain = 'ethereum'): string {
  const bases: Record<string, string> = {
    ethereum: 'https://etherscan.io/tx/',
    base: 'https://basescan.org/tx/',
    polygon: 'https://polygonscan.com/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
  };
  const base = bases[chain] ?? bases.ethereum;
  return `${base}${txHash}`;
}

const SEP = '━━━━━━━━━━━━━━━━━━';

// ── Markdown → Telegram HTML converter ───────────────────────────────────────
// The AI responds in Markdown (**bold**, `code`, * bullets). Telegram shows
// asterisks literally in plain-text mode. This converts common Markdown to
// Telegram-compatible HTML so formatting renders properly.
function markdownToHtml(md: string): string {
  let html = escapeHtml(md);
  // **bold** → <b>bold</b>
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  // *italic* (but NOT bullet points like "* item")
  html = html.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '<i>$1</i>');
  // `code` → <code>code</code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bullet points: "* text" or "- text" at line start → "• text"
  html = html.replace(/^[*\-]\s+/gm, '• ');
  return html;
}

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

// ── Send an HTML-formatted message with the persistent quick keyboard ────────
async function sendRichMessage(
  chatId: string,
  text: string,
  options: Omit<SendMessageOptions, 'parseMode'> = {},
) {
  return sendTelegramMessage(chatId, text, {
    ...options,
    parseMode: 'HTML',
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
  const subjectHtml = escapeHtml(truncate(subject, 40));

  switch (type) {
    case 'mint_scheduled': {
      const lines = [
        `🕐 <b>Mint Scheduled</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.taskId) lines.push(`🆔 Task: ${shortId(payload.taskId)}`);
      return lines.join('\n');
    }
    case 'mint_started':
    case 'mint_executing': {
      const lines = [
        `⚡ <b>Mint Executing</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.mintPrice) lines.push(`💰 Price: <b>${escapeHtml(payload.mintPrice)} ETH</b>`);
      if (payload.taskId) lines.push(`🆔 Task: ${shortId(payload.taskId)}`);
      return lines.join('\n');
    }
    case 'mint_success': {
      const lines = [
        `✅ <b>Mint Successful!</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.mintPrice) lines.push(`💰 Price: <b>${escapeHtml(payload.mintPrice)} ETH</b>`);
      if (payload.txHash) {
        const link = explorerTxLink(payload.txHash);
        lines.push(`🔗 Tx: <a href="${link}">${escapeHtml(payload.txHash.slice(0, 18))}…</a>`);
      }
      return lines.join('\n');
    }
    case 'mint_live_detected': {
      const lines = [
        `🚀 <b>Mint Is Live — Executing Now</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.contractAddress) lines.push(`📜 Contract: ${shortAddr(payload.contractAddress)}`);
      return lines.join('\n');
    }
    case 'mint_failed': {
      const errMsg = payload.error ?? '';
      const errLow = errMsg.toLowerCase();
      let errLabel: string;
      let errIcon: string;
      if (errLow.includes('insufficient funds') || errLow.includes('insufficient balance')) {
        errIcon = '💸'; errLabel = 'Insufficient funds';
      } else if (errLow.includes('balance') || errLow.includes('too low')) {
        errIcon = '💸'; errLabel = 'Balance too low';
      } else if (errLow.includes('reverted') || errLow.includes('execution reverted')) {
        errIcon = '🔁'; errLabel = 'Contract reverted';
      } else if (errLow.includes('nonce') || errLow.includes('replacement transaction')) {
        errIcon = '🔄'; errLabel = 'Nonce conflict';
      } else if (errLow.includes('gas') || errLow.includes('intrinsic')) {
        errIcon = '⛽'; errLabel = 'Gas estimation failed';
      } else if (errLow.includes('timeout') || errLow.includes('timed out')) {
        errIcon = '⏱'; errLabel = 'Execution timed out';
      } else if (errMsg) {
        errIcon = '⚠️'; errLabel = truncate(errMsg, 60);
      } else {
        errIcon = '⚠️'; errLabel = 'Unknown error';
      }
      const lines = [
        `❌ <b>Mint Failed</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
        `${errIcon} <i>${escapeHtml(errLabel)}</i>`,
      ];
      if (payload.mintPrice) lines.push(`💰 Price: ${escapeHtml(payload.mintPrice)} ETH`);
      if (payload.taskId) lines.push(`🆔 Task: ${shortId(payload.taskId)}`);
      return lines.join('\n');
    }
    case 'high_risk_collection': {
      const lines = [
        `🚨 <b>High Risk Collection</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.riskReason) lines.push(`⚠️ ${escapeHtml(payload.riskReason)}`);
      return lines.join('\n');
    }
    case 'risk_analysis_complete': {
      const lines = [
        `🛡 <b>Risk Analysis Complete</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.confidence !== undefined) lines.push(`📊 Confidence: <b>${Math.round(payload.confidence * 100)}%</b>`);
      return lines.join('\n');
    }
    case 'wallet_balance_low': {
      const lines = [
        `📉 <b>Wallet Balance Low</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.balance && payload.symbol) lines.push(`💰 Balance: <b>${escapeHtml(payload.balance)} ${escapeHtml(payload.symbol)}</b>`);
      return lines.join('\n');
    }
    case 'wallet_minted_nft': {
      const lines = [
        `🐋 <b>Tracked Wallet Minted NFT</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.txHash) {
        const link = explorerTxLink(payload.txHash);
        lines.push(`🔗 Tx: <a href="${link}">${escapeHtml(payload.txHash.slice(0, 18))}…</a>`);
      }
      return lines.join('\n');
    }
    case 'wallet_purchased_nft': {
      const lines = [
        `🐋 <b>Tracked Wallet Purchased NFT</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      if (payload.txHash) {
        const link = explorerTxLink(payload.txHash);
        lines.push(`🔗 Tx: <a href="${link}">${escapeHtml(payload.txHash.slice(0, 18))}…</a>`);
      }
      return lines.join('\n');
    }
    case 'copy_mint_triggered': {
      const lines = [
        `📋 <b>Copy Mint Triggered</b>`,
        `${SEP}`,
        `📦 ${subjectHtml}`,
      ];
      return lines.join('\n');
    }
    default:
      return escapeHtml(subject);
  }
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

    const text = formatNotification(type, payload);

    // Build contextual inline buttons per notification type
    let replyMarkup: InlineKeyboardMarkup | undefined;

    if (type === 'mint_scheduled' && payload.taskId) {
      replyMarkup = {
        inline_keyboard: [[
          { text: '🛑 Cancel Task', callback_data: `schedule:cancel:${payload.taskId}` },
        ]],
      };
    } else if (type === 'mint_success' && payload.txHash) {
      const link = explorerTxLink(payload.txHash);
      replyMarkup = {
        inline_keyboard: [[
          { text: '🔗 View on Etherscan', url: link },
        ]],
      };
    } else if (type === 'mint_failed' && payload.taskId) {
      replyMarkup = {
        inline_keyboard: [[
          { text: '🔄 Retry Mint', callback_data: `retry:mint:${payload.taskId}` },
        ]],
      };
    }

    await sendRichMessage(account.chatId, text, { replyMarkup });
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

    const primaryLabel = params.action === 'schedule' ? '𧨔️ Schedule Anyway' : '⚡ Mint Anyway';
    const primaryAction = params.action === 'schedule' ? 'schedule_anyway' : 'mint_anyway';
    const reasons = params.riskReasons.slice(0, 5).map((r) => `• ${escapeHtml(r)}`).join('\n');

    const text = [
      `🚨 <b>High Risk ${params.action === 'schedule' ? 'Scheduled Mint' : 'Live Mint'}</b>`,
      `${SEP}`,
      `🛡️ Risk Score: <b>${params.riskScore}/100</b>`,
      '',
      reasons || '<i>No specific risk reasons available.</i>',
    ].join('\n');

    await sendRichMessage(account.chatId, text, {
      replyMarkup: {
        inline_keyboard: [[
          { text: primaryLabel, callback_data: `risk:${primaryAction}:${params.taskId}` },
          { text: '🛑 Cancel', callback_data: `risk:cancel:${params.taskId}` },
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

    const arrow = params.currentScore > params.previousScore ? '⬆️' : '⬇️';
    const text = [
      `🛡️ <b>Risk Score Changed</b>`,
      `${SEP}`,
      `Previous: <b>${params.previousScore}/100</b>`,
      `${arrow} Current: <b>${params.currentScore}/100</b>`,
    ].join('\n');

    await sendRichMessage(account.chatId, text, {
      replyMarkup: {
        inline_keyboard: [[
          { text: '⚡ Mint Anyway', callback_data: `risk:approve_mint:${params.taskId}` },
          { text: '🛑 Cancel', callback_data: `risk:cancel:${params.taskId}` },
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

  // Send directly — wallet_balance_low is not in MINT_NOTIFICATION_TYPES
  try {
    const account = await getTelegramAccountByUserId(params.userId);
    if (!account) return { sent: false, reason: 'telegram_not_linked' };

    const text = [
      `📉 <b>Wallet Balance Low</b>`,
      `${SEP}`,
      `📍 Address: ${shortAddr(params.address)}`,
      `🌐 Chain: <b>${escapeHtml(params.chain)}</b>`,
      `💰 Balance: <b>${escapeHtml(params.balance)} ${escapeHtml(params.symbol)}</b>`,
    ].join('\n');

    await sendRichMessage(account.chatId, text);
    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'telegram_notification_failed',
    };
  }
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

// Plain-text reply — for AI interpreter, mint shortcuts, and external content
// that may contain < > & characters which would break HTML parse mode.
async function reply(message: TelegramMessage, text: string) {
  await sendTelegramMessage(String(message.chat.id), text, { replyMarkup: QUICK_KEYBOARD });
}

// HTML-formatted reply — for our own structured messages with <b>, <code>, etc.
async function replyHtml(message: TelegramMessage, text: string) {
  await sendRichMessage(String(message.chat.id), text, { replyMarkup: QUICK_KEYBOARD });
}

// HTML reply with inline buttons (no persistent keyboard — Telegram only allows one reply_markup)
async function replyWithButtons(
  message: TelegramMessage,
  text: string,
  inlineKeyboard: InlineKeyboardMarkup,
) {
  await sendRichMessage(String(message.chat.id), text, { replyMarkup: inlineKeyboard });
}

function accountRequiredText() {
  return `⚠️ <b>Telegram Not Linked</b>
${SEP}
Open <a href="https://app.automint.xyz/settings/notifications">AutoMint Settings</a>, generate a Telegram link token, then send:
<code>/start &lt;token&gt;</code> here.`;
}

async function handleStart(message: TelegramMessage, token: string) {
  if (!message.from) {
    await reply(message, '⚠️ Unable to link Telegram without a Telegram user ID.');
    return;
  }

  if (!token) {
    await replyHtml(message, accountRequiredText());
    return;
  }

  const account = await linkTelegramAccount({
    token,
    telegramId: String(message.from.id),
    username: message.from.username || null,
    chatId: String(message.chat.id),
  });

  const welcomeText = [
    `✅ <b>Telegram linked to your AutoMint account!</b>`,
    ``,
    `You can now control your full AutoMint platform from here.`,
    ``,
    `${SEP}`,
    `<b>⚡ Quick Actions</b>`,
    `• Just paste a URL to mint instantly`,
    `• Tap a button below for common actions`,
    ``,
    `<b>📣 Commands</b>`,
    `• <code>/mint &lt;url&gt; [qty]</code> — queue a mint`,
    `• <code>/watch &lt;wallet&gt;</code> — track a whale`,
    `• <code>/status</code> — active mints`,
    `• <code>/cancel</code> — cancel latest mint`,
    `• <code>/settings</code> — view settings`,
    `• <code>/model</code> — change AI model`,
    `• <code>/help</code> — full command guide`,
    ``,
    `Or just type anything in plain English — the AI handles it 🤖`,
  ].join('\n');

  await sendRichMessage(account.chatId, welcomeText, { replyMarkup: QUICK_KEYBOARD });
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
    await replyHtml(message, [
      `📦 <b>Mint Command Usage</b>`,
      `${SEP}`,
      `<code>/mint &lt;url&gt; [qty]</code>`,
      ``,
      `<b>Examples:</b>`,
      `• <code>/mint https://... 1</code> (default)`,
      `• <code>/mint https://... 5</code>`,
      `• <code>https://... 3</code> (bare URL)`,
      ``,
      `<i>Max: ${MAX_MINT_QUANTITY} NFTs per mint</i>`,
    ].join('\n'));
    return;
  }

  const wallet = await loadDefaultWallet(userId);
  if (!wallet) {
    await replyHtml(message, `⚠️ Add a wallet in <a href="https://app.automint.xyz/wallets">AutoMint</a> before triggering a mint from Telegram.`);
    return;
  }

  const parsed = parseMintInput(rawInput);
  if ('error' in parsed) { await reply(message, parsed.error); return; }
  const { url, quantity } = parsed;

  const result = await createMintTaskFromUrl(url, wallet.id, userId, quantity);
  const qtyLabel = `${quantity} NFT${quantity > 1 ? 's' : ''}`;

  if (result.action === 'FAILED') {
    await sendTelegramNotification(userId, 'mint_failed', { url, error: result.error });
    await replyHtml(message, `❌ <b>Mint Failed</b>\n${escapeHtml(result.error || 'Unknown error')}`);
    return;
  }

  if (result.action === 'MONITORING') {
    await sendTelegramNotification(userId, 'mint_created', { url, taskId: result.taskId });
    void publishEvent(userId, 'mint:created', { taskId: result.taskId, url });
    await replyHtml(
      message,
      [
        `⏳ <b>Monitoring Started</b>`,
        `${SEP}`,
        `🧱 Task: ${shortId(result.taskId ?? '')}`,
        `📦 Qty: <b>${escapeHtml(qtyLabel)}</b>`,
        ``,
        `<i>You'll be notified when the mint goes live.</i>`,
      ].join('\n'),
    );
    return;
  }

  // TASK_CREATED: mint is live — task queued for near-immediate execution via QStash.
  await sendTelegramNotification(userId, 'mint_created', { url, taskId: result.taskId });
  void publishEvent(userId, 'mint:created', { taskId: result.taskId, url });
  await replyHtml(
    message,
    [
      `✅ <b>Mint Task Created</b>`,
      `${SEP}`,
      `🧱 Task: ${shortId(result.taskId ?? '')}`,
      `📦 Qty: <b>${escapeHtml(qtyLabel)}</b>`,
      ``,
      `<i>Execution starting shortly — you'll be notified on completion.</i>`,
    ].join('\n'),
  );
}

async function handleScheduleCommand(message: TelegramMessage, userId: string, url: string) {
  if (!url) {
    await replyHtml(message, `📦 <b>Schedule Command Usage</b>\n${SEP}\n<code>/schedule &lt;url&gt;</code>`);
    return;
  }

  const wallet = await loadDefaultWallet(userId);
  if (!wallet) {
    await replyHtml(message, `⚠️ Add a wallet in <a href="https://app.automint.xyz/wallets">AutoMint</a> before scheduling a mint.`);
    return;
  }

  const normalizedInput = url.startsWith('0x') ? `https://etherscan.io/address/${url}` : url;
  const intent = await resolveMintIntent(normalizedInput);
  if (!intent.contractAddress) {
    await replyHtml(message, '❌ Could not resolve a contract address from that URL.');
    return;
  }

  const [mintState, requirements] = await Promise.all([
    getMintState(intent.contractAddress, intent.chain),
    fetchMintRequirements(intent.contractAddress, intent.chain),
  ]);

  if (mintState.status === 'ENDED') {
    await sendTelegramNotification(userId, 'mint_failed', { url, error: 'Mint has already ended' });
    await replyHtml(message, '🚫 <b>This mint has already ended.</b>');
    return;
  }

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
      await replyHtml(message, `🛡️ <b>Risk Approval Requested</b>\n${SEP}\n🧱 Task: ${shortId(scheduledTask.id)}`);
      return;
    }
    await replyHtml(message, [
      `🕒 <b>Mint Scheduled</b>`,
      `${SEP}`,
      `🧱 Task: ${shortId(scheduledTask.id)}`,
    ].join('\n'));
    return;
  }

  const { requireRiskApproval } = await import('@/lib/services/risk.service');
  const riskGate = await requireRiskApproval({ taskId: task.id, action: 'mint', userId });
  if (!riskGate.approved) {
    await replyHtml(message, `🛡️ <b>Risk Approval Requested</b>\n${SEP}\n🧱 Task: ${shortId(task.id)}`);
    return;
  }

  await sendTelegramNotification(userId, 'mint_created', {
    url,
    taskId: task.id,
    contractAddress: intent.contractAddress,
  });
  await replyHtml(message, [
    `🚀 <b>Mint Is Live and Ready</b>`,
    `${SEP}`,
    `🧱 Task: ${shortId(task.id)}`,
  ].join('\n'));
}

async function handleWatchCommand(message: TelegramMessage, userId: string, address: string) {
  if (!address || !isValidEthereumAddress(address)) {
    await replyHtml(message, `📦 <b>Watch Command Usage</b>\n${SEP}\n<code>/watch &lt;wallet&gt;</code>\n\n<i>Example: <code>/watch 0x1234...</code></i>`);
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

    const statusIcon = wallet.active ? '✅' : '⏸';
    await replyHtml(message, [
      `👁 <b>Whale Wallet Tracker Enabled</b>`,
      `${SEP}`,
      `📍 Address: ${shortAddr(wallet.walletAddress)}`,
      `🌐 Chain: <b>${escapeHtml(wallet.chain)}</b>`,
      `${statusIcon} Status: <b>${wallet.active ? 'Active' : 'Inactive'}</b>`,
      `💰 Balance: <b>${escapeHtml(balance.balance)} ${escapeHtml(balance.symbol)}</b>`,
    ].join('\n'));
  } catch (error) {
    await replyHtml(message, `❌ ${escapeHtml(error instanceof Error ? error.message : 'Failed to watch wallet.')}`);
  }
}

async function handleStatusCommand(message: TelegramMessage, userId: string) {
  try {
  const rows = await getDb()
    .select()
    .from(mintTasks)
    .where(eq(mintTasks.userId, userId))
    .orderBy(desc(mintTasks.createdAt))
    .limit(10);

  if (rows.length === 0) {
    await replyHtml(message, [
      `📋 <b>Mint Status</b>`,
      `${SEP}`,
      `<i>No mint tasks yet. Paste a URL or use /mint to get started!</i>`,
    ].join('\n'));
    return;
  }

  const counts = rows.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});

  const statusIcons: Record<string, string> = {
    pending: '⏳',
    monitoring: '👁',
    ready: '✅',
    running: '⚡',
    completed: '🏆',
    failed: '❌',
    cancelled: '🚫',
    unconfirmed: '❔',
  };

  const statusLines = Object.entries(counts).map(([status, count]) =>
    `${statusIcons[status] ?? '❔'} ${escapeHtml(status)}: <b>${count}</b>`
  );

  const lines = [
    `📋 <b>Mint Status</b>`,
    `${SEP}`,
    ...statusLines,
    ``,
    `<b>Recent Tasks:</b>`,
  ];

  // Show up to 5 recent tasks with status icons
  for (const task of rows.slice(0, 5)) {
    const icon = statusIcons[task.status] ?? '❔';
    const addr = task.contractAddress ? shortAddr(task.contractAddress) : shortId(task.id);
    lines.push(`${icon} ${addr} — <i>${escapeHtml(task.status)}</i>`);
  }

  // Build inline buttons for cancellable tasks
  const cancellable = rows.filter(t =>
    ['pending', 'monitoring', 'ready', 'running'].includes(t.status)
  );

  const inlineKeyboard: InlineKeyboardMarkup | undefined =
    cancellable.length > 0
      ? {
          inline_keyboard: cancellable.slice(0, 4).map(t => [{
            text: `🛑 Cancel ${t.id.slice(0, 8)}`,
            callback_data: `schedule:cancel:${t.id}`,
          }]),
        }
      : undefined;

  if (inlineKeyboard) {
    await replyWithButtons(message, lines.join('\n'), inlineKeyboard);
  } else {
    await replyHtml(message, lines.join('\n'));
  }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to get status';
    logger.error('handleStatusCommand error', { area: 'telegram', userId, error: errMsg });
    await replyHtml(message, `❌ <b>Error</b>\n${escapeHtml(errMsg)}`);
  }
}

async function handleCancelCommand(message: TelegramMessage, userId: string) {
  try {
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
      await replyHtml(message, [
        `🛑 <b>Cancel Mint</b>`,
        `${SEP}`,
        `<i>No cancellable mint task found.</i>`,
      ].join('\n'));
      return;
    }

    const task = await cancelScheduledMint(target.id, userId);

    void publishEvent(userId, 'mint:cancelled', { taskId: task.id });
    await replyHtml(message, [
      `🛑 <b>Mint Task Cancelled</b>`,
      `${SEP}`,
      `🧾 Task: ${shortId(task.id)}`,
    ].join('\n'));
  } catch (error) {
    // Bug fix: this try block previously had no matching catch/finally --
    // a syntax error that made the entire file fail to parse under
    // tsc/eslint/vitest (Next.js's own dev/build pipeline tolerated it, so
    // it went unnoticed -- there is no CI running these checks on push).
    // Restored the same error-handling pattern used by the other command
    // handlers (e.g. handleStatusCommand) so a failure here reports back to
    // the user instead of surfacing only as an unhandled 500 on the webhook
    // route.
    const errMsg = error instanceof Error ? error.message : 'Failed to cancel mint';
    logger.error('handleCancelCommand error', { area: 'telegram', userId, error: errMsg });
    await replyHtml(message, `❌ <b>Error</b>\n${escapeHtml(errMsg)}`);
  }
}

async function handleSettingsCommand(message: TelegramMessage, account: { username: string | null; chatId: string }) {
  const username = account.username ? `@${escapeHtml(account.username)}` : '<i>not set</i>';
  await replyHtml(message, [
    `⚙️ <b>AutoMint Telegram Settings</b>`,
    `${SEP}`,
    `👤 Username: ${username}`,
    `💬 Chat ID: <code>${escapeHtml(account.chatId)}</code>`,
    `🔔 Notifications: <b>Enabled</b>`,
    ``,
    `<b>Commands:</b>`,
    `• <code>/mint</code> &lt;url&gt; [qty]`,
    `• <code>/schedule</code> &lt;url&gt;`,
    `• <code>/watch</code> &lt;wallet&gt;`,
    `• <code>/status</code> — active mints`,
    `• <code>/cancel</code> — cancel latest mint`,
    `• <code>/model</code> — change AI model`,
    `• <code>/help</code> — full guide`,
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
  await sendRichMessage(
    String(message.chat.id),
    [
      `🤖 <b>AI Model Selection</b>`,
      `${SEP}`,
      `Current: <b>${escapeHtml(currentInfo?.label ?? current)}</b>`,
      `<i>${escapeHtml(currentInfo?.description ?? '')}</i>`,
      ``,
      `<i>Tap a model to switch:</i>`,
    ].join('\n'),
    { replyMarkup: keyboard },
  );
}

// ── /help command — full command guide with inline buttons ─────────────────
async function handleHelpCommand(message: TelegramMessage) {
  const helpText = [
    `❓ <b>AutoMint Help</b>`,
    `${SEP}`,
    `<b>⚡ Minting</b>`,
    `• <code>/mint &lt;url&gt; [qty]</code> — Queue a mint`,
    `• <code>/schedule &lt;url&gt;</code> — Schedule a future mint`,
    `• Paste any URL directly to mint instantly`,
    ``,
    `<b>👁 Tracking</b>`,
    `• <code>/watch &lt;wallet&gt;</code> — Track a whale wallet`,
    ``,
    `<b>📋 Status & Control</b>`,
    `• <code>/status</code> — View active mints`,
    `• <code>/cancel</code> — Cancel latest mint`,
    ``,
    `<b>⚙️ Settings</b>`,
    `• <code>/settings</code> — View Telegram settings`,
    `• <code>/model</code> — Switch AI model`,
    ``,
    `<b>🤖 AI</b>`,
    `• Type anything in plain English`,
    `• The AI handles it automatically`,
    ``,
    `<i>Or use the quick buttons below the chat input!</i>`,
  ].join('\n');

  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [[
      { text: '📋 Status', callback_data: 'nav:status' },
      { text: '⚙️ Settings', callback_data: 'nav:settings' },
      { text: '🤖 Model', callback_data: 'nav:model' },
    ]],
  };

  await replyWithButtons(message, helpText, keyboard);
}

// ── /menu command — compact menu with inline action buttons ──────────────────
async function handleMenuCommand(message: TelegramMessage) {
  const menuText = [
    `🖼 <b>AutoMint Menu</b>`,
    `${SEP}`,
    `<i>Tap an action below to get started:</i>`,
  ].join('\n');

  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: [
      [
        { text: '📋 My Mints', callback_data: 'nav:status' },
        { text: '👁 Watch Whale', callback_data: 'nav:watch' },
      ],
      [
        { text: '⚙️ Settings', callback_data: 'nav:settings' },
        { text: '🤖 AI Model', callback_data: 'nav:model' },
      ],
      [
        { text: '❓ Help', callback_data: 'nav:help' },
      ],
    ],
  };

  await replyWithButtons(message, menuText, keyboard);
}

// ── Handle nav: callback queries from help/menu inline buttons ───────────────
async function handleNavCallback(callback: TelegramCallbackQuery) {
  const navAction = (callback.data || '').split(':')[1];
  if (!navAction) return { handled: false };

  const account = await getTelegramAccountByTelegramId(String(callback.from.id));
  if (!account) {
    await answerCallbackQuery(callback.id, 'Telegram is not linked.');
    return { handled: true };
  }

  // For nav callbacks we need a synthetic message-like object
  const fakeMessage: TelegramMessage = {
    message_id: callback.message?.message_id ?? 0,
    from: callback.from,
    chat: callback.message?.chat ?? { id: Number(account.chatId), type: 'private' },
    text: '',
  };

  switch (navAction) {
    case 'status':
      await answerCallbackQuery(callback.id, 'Loading status...');
      await handleStatusCommand(fakeMessage, account.userId);
      return { handled: true };
    case 'settings':
      await answerCallbackQuery(callback.id, 'Loading settings...');
      await handleSettingsCommand(fakeMessage, { username: account.username, chatId: account.chatId });
      return { handled: true };
    case 'model':
      await answerCallbackQuery(callback.id, 'Loading models...');
      await handleModelCommand(fakeMessage, account.userId);
      return { handled: true };
    case 'help':
      await answerCallbackQuery(callback.id, 'Loading help...');
      await handleHelpCommand(fakeMessage);
      return { handled: true };
    case 'watch':
      await answerCallbackQuery(callback.id, 'Use /watch <address>');
      await sendRichMessage(account.chatId, `👁 <b>Watch a Whale Wallet</b>\n${SEP}\nUse: <code>/watch &lt;0xaddress&gt;</code>\n\n<i>Example:</i> <code>/watch 0x1234...</code>`);
      return { handled: true };
    default:
      return { handled: false };
  }
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
    await sendRichMessage(account.chatId, [`🛑 <b>Mint Task Cancelled</b>`, `${SEP}`, `🧱 Task: ${shortId(taskId)}`].join('\n'));
    return { handled: true };
  }

  if (action === 'schedule_anyway') {
    const { scheduleMint } = await import('@/lib/services/qstash.service');
    await scheduleMint({ taskId, userId: account.userId, overrideRiskFlag: true });
    await answerCallbackQuery(callback.id, 'Scheduled.');
    await sendRichMessage(account.chatId, [`🕒 <b>Mint Scheduled</b>`, `${SEP}`, `🧱 Task: ${shortId(taskId)}`].join('\n'));
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
    await sendRichMessage(
      account.chatId,
      result.success
        ? [`✅ <b>Mint Approved</b>`, `${SEP}`, `🧱 Task: ${shortId(taskId)}` + (result.txHash ? `\n🔗 Tx: <code>${escapeHtml(result.txHash.slice(0, 18))}...</code>` : '')].join('\n')
        : [`❌ <b>Mint Failed</b>`, `${SEP}`, `🧱 Task: ${shortId(taskId)}`, `⚠️ ${escapeHtml(result.error || 'Unknown error')}`].join('\n'),
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
    await sendRichMessage(account.chatId, [`✅ <b>Mint Approved</b>`, `${SEP}`, `🧱 Task: ${shortId(taskId)}`].join('\n'));
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
        await sendRichMessage(
          account.chatId,
          [
            `🛑 <b>Mint Task Cancelled</b>`,
            `${SEP}`,
            `🧱 Task: ${shortId(task.id)}`,
          ].join('\n'),
        );
      } catch (cancelError) {
        const msg = cancelError instanceof Error ? cancelError.message : 'Cancel failed';
        await answerCallbackQuery(callback.id, `Failed: ${msg.slice(0, 50)}`);
        await sendRichMessage(
          account.chatId,
          `❌ Could not cancel task ${shortId(taskId)}: ${escapeHtml(msg.slice(0, 120))}`,
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

// ── Handle retry:mint callback from failed mint notifications ────────────────
async function handleRetryCallback(callback: TelegramCallbackQuery) {
  try {
    const [scope, , taskId] = (callback.data || '').split(':');
    if (scope !== 'retry' || !taskId) {
      return { handled: false };
    }

    const account = await getTelegramAccountByTelegramId(String(callback.from.id));
    if (!account) {
      await answerCallbackQuery(callback.id, 'Telegram is not linked to AutoMint.');
      return { handled: true };
    }

    const { scheduleMint } = await import('@/lib/services/qstash.service');
    const task = await scheduleMint({ taskId, userId: account.userId });
    await answerCallbackQuery(callback.id, '✅ Mint retried');
    await sendRichMessage(
      account.chatId,
      [
        `🔄 <b>Mint Retry Started</b>`,
        `${SEP}`,
        `🧱 Task: ${shortId(task.id)}`,
        `<i>You'll be notified when it completes.</i>`,
      ].join('\n'),
    );
    return { handled: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Retry failed';
    await answerCallbackQuery(callback.id, `Failed: ${msg.slice(0, 50)}`);
    return { handled: true };
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (!isTelegramEnabled()) return { handled: false, disabled: true };

  if (update.callback_query?.data) {
    // Nav callbacks from help/menu buttons
    if (update.callback_query.data.startsWith('nav:')) {
      const navResult = await handleNavCallback(update.callback_query);
      if (navResult.handled) return navResult;
    }
    // Retry callbacks from failed mint notifications
    if (update.callback_query.data.startsWith('retry:')) {
      const retryResult = await handleRetryCallback(update.callback_query);
      if (retryResult.handled) return retryResult;
    }
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

  // ── Map quick-keyboard button labels to commands ─────────────────────────
  const quickButtonMap: Record<string, string> = {
    '⚡ Quick Mint': '/mint',
    '📊 Status': '/status',
    '👁 Watch Whale': '/watch',
    '🛑 Cancel': '/cancel',
    '⚙️ Settings': '/settings',
    '❓ Help': '/help',
  };
  const mappedCommand = quickButtonMap[message.text.trim()];
  if (mappedCommand) {
    // Re-parse as the mapped command
    const effectiveCommand = mappedCommand;

    if (effectiveCommand === '/help') {
      await handleHelpCommand(message);
      return { handled: true };
    }

    if (!message.from) {
      await reply(message, 'Unable to process command without a Telegram user ID.');
      return { handled: true };
    }
    const account = await getTelegramAccountByTelegramId(String(message.from.id));
    if (!account) {
      await replyHtml(message, accountRequiredText());
      return { handled: true };
    }

    switch (effectiveCommand) {
      case '/mint':
        // For "Quick Mint" button, show usage hint
        await replyHtml(message, [
          `⚡ <b>Quick Mint</b>`,
          `${SEP}`,
          `Paste a URL or use:`,
          `<code>/mint &lt;url&gt; [qty]</code>`,
          ``,
          `<i>Example: <code>/mint https://... 2</code></i>`,
        ].join('\n'));
        return { handled: true };
      case '/status':
        await handleStatusCommand(message, account.userId);
        return { handled: true };
      case '/watch':
        await replyHtml(message, `👁 <b>Watch a Whale Wallet</b>\n${SEP}\nUse: <code>/watch &lt;0xaddress&gt;</code>`);
        return { handled: true };
      case '/cancel':
        await handleCancelCommand(message, account.userId);
        return { handled: true };
      case '/settings':
        await handleSettingsCommand(message, account);
        return { handled: true };
    }
  }

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
        await replyHtml(message, accountRequiredText());
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
        await replyHtml(message, markdownToHtml(aiReply));
      } catch (_aiUrlError) {
        logger.warn('AI interpreter failed for URL, falling back to handleMintCommand', { area: 'telegram', error: _aiUrlError instanceof Error ? _aiUrlError.message : String(_aiUrlError) });
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
        await replyHtml(message, accountRequiredText());
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
        await replyHtml(message, markdownToHtml(aiReply));
      } catch (_aiError) {
        logger.warn('AI interpreter failed for non-URL text', { area: 'telegram', error: _aiError instanceof Error ? _aiError.message : String(_aiError) });
        await replyHtml(
          message,
          [
            `❌ <b>AI Processing Failed</b>`,
            `${SEP}`,
            `<i>Try a slash command:</i>`,
            `<code>/mint</code> • <code>/watch</code> • <code>/status</code> • <code>/cancel</code> • <code>/help</code>`,
          ].join('\n'),
        );
      }
    }
    return { handled: true };
  }

  if (command === '/start') {
    await handleStart(message, rawArgs);
    return { handled: true };
  }

  // /help and /menu — Telegram-UI-only commands
  if (command === '/help') {
    await handleHelpCommand(message);
    return { handled: true };
  }

  if (command === '/menu') {
    if (!message.from) {
      await reply(message, 'Unable to process command without a Telegram user ID.');
      return { handled: true };
    }
    const account = await getTelegramAccountByTelegramId(String(message.from.id));
    if (!account) {
      await replyHtml(message, accountRequiredText());
      return { handled: true };
    }
    await handleMenuCommand(message);
    return { handled: true };
  }

  if (!message.from) {
    await reply(message, 'Unable to process command without a Telegram user ID.');
    return { handled: true };
  }

  const account = await getTelegramAccountByTelegramId(String(message.from.id));
  if (!account) {
    await replyHtml(message, accountRequiredText());
    return { handled: true };
  }

  // /model is Telegram-UI-only (inline keyboard) — keep it native.
  if (command === '/model') {
    await handleModelCommand(message, account.userId);
    return { handled: true };
  }

  // ── Route ALL other commands through the AI interpreter ──────────────────
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
    await replyHtml(message, markdownToHtml(aiReply));
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
      case '/help':
        await handleHelpCommand(message);
        break;
      default:
        await replyHtml(message, [
          `❌ <b>AI Processing Failed</b>`,
          `${SEP}`,
          `<i>Try again or use </i><code>/help</code><i> for the command guide.</i>`,
        ].join('\n'));
        break;
    }
  }

  return { handled: true };
}
