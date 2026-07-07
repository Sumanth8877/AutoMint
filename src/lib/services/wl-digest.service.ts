import 'server-only';

import { getDb } from '@/lib/db';
import { telegramAccounts } from '@/drizzle/schema';
import { listPendingCheckins } from '@/lib/services/wl-checkin.service';
import { sendTelegramMessage } from '@/lib/services/telegram.service';
import { logger } from '@/lib/logger';

// ─── WL Daily Digest ─────────────────────────────────────────────────────
// Runs once a day (via QStash schedule) at a UTC hour approximating the
// user base's morning. For each user with a linked Telegram account,
// gathers today's pending check-ins and sends a single consolidated
// Telegram message. Users with no pending check-ins get no message —
// the digest never spams "you're all caught up".
//
// Timezone strategy: v1 uses a single global UTC "day" boundary. When we
// add per-user preferred_timezone / preferred_digest_hour columns, the
// cron will fan out per timezone bucket. For now, if the user is in
// Asia/Calcutta and the cron fires at UTC 03:00, they receive it at
// 08:30 local — an acceptable default for an Indian-based user base.

const DEFAULT_TZ = 'UTC';

export type DigestRunResult = {
  usersProcessed: number;
  digestsSent: number;
  totalPending: number;
  errors: number;
};

export async function runDailyDigest(opts: { timezone?: string } = {}): Promise<DigestRunResult> {
  const tz = opts.timezone ?? DEFAULT_TZ;
  const result: DigestRunResult = {
    usersProcessed: 0,
    digestsSent: 0,
    totalPending: 0,
    errors: 0,
  };

  // Load every linked Telegram account — telegram_accounts already carries
  // userId + chatId, so we don't need a join with the users table for the
  // digest.
  const accounts = await getDb()
    .select({
      userId: telegramAccounts.userId,
      chatId: telegramAccounts.chatId,
    })
    .from(telegramAccounts);

  for (const row of accounts) {
    result.usersProcessed += 1;

    let pending;
    try {
      pending = await listPendingCheckins(row.userId, tz);
    } catch (error) {
      result.errors += 1;
      logger.warn('WL digest: failed to list pending', {
        area: 'wl-digest',
        userId: row.userId,
        error: (error as Error).message,
      });
      continue;
    }

    if (pending.length === 0) continue;
    result.totalPending += pending.length;

    const message = renderDigest(pending);
    try {
      await sendTelegramMessage(String(row.chatId), message, {
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
      result.digestsSent += 1;
    } catch (error) {
      result.errors += 1;
      logger.warn('WL digest: failed to send Telegram', {
        area: 'wl-digest',
        userId: row.userId,
        error: (error as Error).message,
      });
    }
  }

  logger.info('WL digest: complete', { area: 'wl-digest', ...result });
  return result;
}

function renderDigest(pending: Awaited<ReturnType<typeof listPendingCheckins>>): string {
  const lines: string[] = [];
  lines.push(`☀️ <b>Good morning — ${pending.length} daily check-in${pending.length === 1 ? '' : 's'} to do today</b>`);
  lines.push('');

  for (const p of pending.slice(0, 25)) {
    const streakBadge = p.streakDays > 0 ? `  🔥 ${p.streakDays}-day streak` : '';
    const url = p.dailyCheckinUrl ? `\n   🔗 ${escapeHtml(p.dailyCheckinUrl)}` : '';
    const timeHint = p.dailyCheckinTimeHint ? `  ⏰ ${escapeHtml(p.dailyCheckinTimeHint)}` : '';
    lines.push(`• <b>${escapeHtml(p.projectName)}</b> ${escapeHtml(p.twitterHandle)}${streakBadge}${timeHint}${url}`);
  }
  if (pending.length > 25) {
    lines.push('', `…and ${pending.length - 25} more on the dashboard.`);
  }

  lines.push('');
  lines.push('Reply <code>checkin @handle</code> after finishing each one to keep the streak alive.');
  return lines.join('\n');
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
