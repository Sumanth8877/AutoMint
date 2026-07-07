import 'server-only';

import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { trackedTweets } from '@/drizzle/schema/wl-tracker';
import { getTelegramAccountByUserId, sendTelegramMessage } from '@/lib/services/telegram.service';
import { logger } from '@/lib/logger';
import type { TrackedProject, TrackedTweet } from '@/lib/services/wl-tracker.service';

// ─── WL Notifier ─────────────────────────────────────────────────────────
// Delivers a rich Telegram message when a classified tweet is worth the
// user's attention. Rules:
//   - urgency=critical or wallet_matched=true → send with 🚨 header
//   - urgency=high                            → send with 🔔 header
//   - urgency=medium                          → send with 📢 header
//   - urgency=low                             → NOT sent (feed-only)
//
// Notifications are idempotent — trackedTweets.notifiedAt is set atomically
// so a re-run of the watcher won't duplicate messages.

export async function notifyWlTweet(params: {
  userId: string;
  project: TrackedProject;
  tweet: TrackedTweet;
}): Promise<void> {
  const { userId, project, tweet } = params;

  // Idempotency guard: refuse to notify twice.
  if (tweet.notifiedAt) {
    return;
  }

  // Only send Telegram if the user has linked an account.
  const account = await getTelegramAccountByUserId(userId);
  if (!account) {
    logger.debug('WL notifier: user has no linked Telegram account', {
      area: 'wl-notifier',
      userId,
      tweetId: tweet.tweetId,
    });
    // Still stamp notifiedAt so the tweet doesn't get retried forever.
    await stampNotified(tweet.id);
    return;
  }

  const message = renderTelegramMessage(project, tweet);
  const result = await sendTelegramMessage(String(account.chatId), message, {
    parseMode: 'HTML',
    disableWebPagePreview: false,
  });

  if (result) {
    await stampNotified(tweet.id);
  } else {
    logger.warn('WL notifier: telegram send returned null', {
      area: 'wl-notifier',
      userId,
      tweetId: tweet.tweetId,
    });
  }
}

async function stampNotified(rowId: string): Promise<void> {
  await getDb()
    .update(trackedTweets)
    .set({ notifiedAt: new Date() })
    .where(eq(trackedTweets.id, rowId));
}

// ─── Message rendering ───────────────────────────────────────────────────
// Telegram HTML has a narrow whitelist — <b>, <i>, <a>, <code>, <pre>. We
// escape user-controlled strings (project name, tweet text) so a project
// tweeting "<script>" doesn't break formatting.

function renderTelegramMessage(project: TrackedProject, tweet: TrackedTweet): string {
  const header = pickHeader(tweet);
  const categoryLabel = CATEGORY_LABELS[tweet.category] ?? tweet.category;
  const projectName = escapeHtml(project.projectName);
  const summary = escapeHtml(tweet.aiSummary || tweet.tweetText.slice(0, 200));
  const preview = escapeHtml(tweet.tweetText.slice(0, 400));

  const lines: string[] = [];
  lines.push(`${header} <b>${projectName}</b> — ${categoryLabel}`);
  lines.push('');
  if (tweet.walletMatched) {
    lines.push('⚡ <b>Your wallet was mentioned in this tweet.</b>');
    lines.push('');
  }
  lines.push(`<i>${summary}</i>`);
  lines.push('');
  lines.push(`<b>Tweet:</b>`);
  lines.push(preview);
  lines.push('');

  if (tweet.extractedMintUrl) {
    lines.push(`🔗 <b>Mint link:</b> ${escapeHtml(tweet.extractedMintUrl)}`);
  }
  lines.push(`👉 <a href="${escapeHtml(tweet.tweetUrl)}">Open tweet</a>`);

  if (project.walletUsed) {
    lines.push(`💼 Wallet you applied with: <code>${escapeHtml(project.walletUsed)}</code>`);
  }

  return lines.join('\n');
}

function pickHeader(tweet: TrackedTweet): string {
  if (tweet.walletMatched) return '🚨🚨';
  if (tweet.urgency === 'critical') return '🚨';
  if (tweet.urgency === 'high') return '🔔';
  if (tweet.urgency === 'medium') return '📢';
  return 'ℹ️';
}

const CATEGORY_LABELS: Record<string, string> = {
  winners_announcement: 'Winners announcement',
  mint_link: 'Mint link',
  mint_reminder: 'Mint reminder',
  delay_postpone: 'Mint delayed',
  general_hype: 'Project update',
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
