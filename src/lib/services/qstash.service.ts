import 'server-only';

import crypto from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getWalletBalance } from '@/lib/blockchain/wallet';
import { mintTasks, wallets } from '@/drizzle/schema';
import { logActivity } from '@/lib/monitoring';
import { executeMintTask } from '@/lib/services/mint.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { requireRiskApproval } from '@/lib/services/risk.service';
import { addBreadcrumb, captureException, captureMessage } from '@/lib/observability/sentry';
import { acquireLock, releaseLock } from '@/lib/services/mint-lock.service';
import { executeScheduledRiskCheck, hasBlockingRiskChange, storeOriginalRiskSnapshot } from '@/lib/services/scheduled-risk-check.service';
import { sendMintFailedEmail, sendMintScheduledEmail, sendSystemErrorEmail } from '@/lib/services/email-notification.service';

const QSTASH_BASE_URL = 'https://qstash.upstash.io';
const DEFAULT_SCHEDULE_DELAY_MS = 60_000;

type QStashPublishResponse = {
  messageId?: string;
  scheduleId?: string;
  url?: string;
};

type QStashJwtPayload = {
  body?: string;
  exp?: number;
  nbf?: number;
  sub?: string;
};

export type ScheduledMintPayload = {
  taskId: string;
  type?: 'execute' | 'risk_check';
};

function getQStashToken() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is not configured');
  return token;
}

function getWebhookUrl() {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return `${appUrl.replace(/\/$/, '')}/api/webhooks/qstash`;

  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl.replace(/\/$/, '')}/api/webhooks/qstash`;

  throw new Error('APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL is required');
}

function getSigningKeys() {
  return [
    process.env.QSTASH_CURRENT_SIGNING_KEY,
    process.env.QSTASH_NEXT_SIGNING_KEY,
  ].filter((key): key is string => Boolean(key));
}

function encodePublishUrl(url: string) {
  return encodeURIComponent(url);
}

function secondsFromDate(date: Date) {
  return Math.max(Math.floor(date.getTime() / 1000), Math.floor(Date.now() / 1000) + 1);
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyJwtSignature(token: string, signingKey: string) {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;

  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`${header}.${payload}`)
    .digest('base64url');

  if (!timingSafeEqualString(signature, expected)) return null;
  return JSON.parse(base64UrlDecode(payload)) as QStashJwtPayload;
}

export function verifyQStashSignature(headers: Headers, rawBody: string) {
  const signature = headers.get('upstash-signature');
  if (!signature) throw new Error('Missing QStash signature');

  const keys = getSigningKeys();
  if (keys.length === 0) throw new Error('QStash signing keys are not configured');

  const now = Math.floor(Date.now() / 1000);
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('base64url');

  for (const key of keys) {
    const payload = verifyJwtSignature(signature, key);
    if (!payload) continue;
    if (payload.exp && payload.exp < now) continue;
    if (payload.nbf && payload.nbf > now) continue;
    if (payload.body && payload.body !== bodyHash) continue;
    return payload;
  }

  throw new Error('Invalid QStash signature');
}

async function publishQStashMessage(taskId: string, scheduledTime: Date, type: ScheduledMintPayload['type'] = 'execute') {
  addBreadcrumb({
    category: 'qstash',
    message: 'scheduling started',
    level: 'info',
    data: { taskId, scheduledTime: scheduledTime.toISOString(), type },
  });
  const webhookUrl = getWebhookUrl();
  const response = await fetch(`${QSTASH_BASE_URL}/v2/publish/${encodePublishUrl(webhookUrl)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getQStashToken()}`,
      'Content-Type': 'application/json',
      'Upstash-Not-Before': String(secondsFromDate(scheduledTime)),
    },
    body: JSON.stringify({ taskId, type } satisfies ScheduledMintPayload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(text || `QStash publish failed with status ${response.status}`);
    const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
    await trackAnalyticsEvent({
      eventType: 'qstash',
      status: 'failed',
      provider: type,
      metadata: { taskId, scheduledTime: scheduledTime.toISOString() },
    });
    await captureException(error, {
      area: 'qstash',
      context: { taskId, scheduledTime: scheduledTime.toISOString(), type },
      fingerprint: ['qstash', 'publish'],
    });
    throw error;
  }

  const result = await response.json() as QStashPublishResponse;
  const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
  await trackAnalyticsEvent({
    eventType: 'qstash',
    status: 'scheduled',
    provider: type,
    metadata: { taskId, scheduledTime: scheduledTime.toISOString(), messageId: result.messageId, scheduleId: result.scheduleId },
  });
  return result;
}

function getRiskCheckTime(scheduledTime: Date) {
  const oneHourBefore = new Date(scheduledTime.getTime() - 60 * 60 * 1000);
  return oneHourBefore.getTime() > Date.now() ? oneHourBefore : undefined;
}

async function deleteQStashMessage(messageId: string) {
  const response = await fetch(`${QSTASH_BASE_URL}/v2/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${getQStashToken()}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `QStash cancel failed with status ${response.status}`);
  }
}

async function sendScheduledMintNotification(
  userId: string,
  type: 'mint_scheduled' | 'mint_failed' | 'wallet_balance_low',
  payload: {
    taskId?: string;
    contractAddress?: string;
    wallet?: string;
    error?: string;
    balance?: string;
    symbol?: string;
  } = {},
) {
  const { sendTelegramNotification } = await import('@/lib/services/telegram.service');
  return sendTelegramNotification(userId, type, payload);
}

export async function scheduleMint(params: {
  taskId: string;
  userId?: string;
  scheduledTime?: Date;
  overrideRiskFlag?: boolean;
}) {
  const [task] = await getDb().select().from(mintTasks).where(eq(mintTasks.id, params.taskId)).limit(1);
  if (!task) throw new Error('Mint task not found');
  if (params.userId && task.userId !== params.userId) throw new Error('Mint task not found');
  if (task.status === 'completed' || task.status === 'running') return task;

  const overrideRiskFlag = params.overrideRiskFlag ?? task.overrideRiskFlag ?? false;
  if (!overrideRiskFlag) {
    const riskGate = await requireRiskApproval({ taskId: task.id, action: 'schedule' });
    if (!riskGate.approved) {
      const [blocked] = await getDb()
        .update(mintTasks)
        .set({
          status: 'pending',
          qstashMessageId: null,
          scheduledTime: null,
          safeModeEnabled: true,
          updatedAt: new Date(),
        })
        .where(eq(mintTasks.id, task.id))
        .returning();

      return blocked ?? task;
    }
  }

  const scheduledTime = params.scheduledTime ?? new Date(Date.now() + DEFAULT_SCHEDULE_DELAY_MS);

  if (task.qstashMessageId) {
    await deleteQStashMessage(task.qstashMessageId);
  }

  const originalRisk = await storeOriginalRiskSnapshot(task.id);
  const riskCheckTime = getRiskCheckTime(scheduledTime);
  if (riskCheckTime && !overrideRiskFlag) {
    await publishQStashMessage(task.id, riskCheckTime, 'risk_check');
  }

  const qstash = await publishQStashMessage(task.id, scheduledTime, 'execute');
  const qstashMessageId = qstash.messageId || qstash.scheduleId;
  if (!qstashMessageId) throw new Error('QStash response did not include a message id');
  addBreadcrumb({
    category: 'qstash',
    message: 'scheduling completed',
    level: 'info',
    data: { taskId: task.id, qstashMessageId, scheduledTime: scheduledTime.toISOString() },
  });

  const [updated] = await getDb()
    .update(mintTasks)
    .set({
      status: 'monitoring',
      qstashMessageId,
      scheduledTime,
      overrideRiskFlag,
      originalRiskScore: originalRisk.riskScore,
      latestRiskScore: originalRisk.riskScore,
      originalRiskReasons: originalRisk.riskReasons,
      latestRiskReasons: originalRisk.riskReasons,
      updatedAt: new Date(),
    })
    .where(eq(mintTasks.id, task.id))
    .returning();

  await logActivity(task.userId, 'task_created', 'Mint scheduled with QStash', {
    taskId: task.id,
    qstashMessageId,
    scheduledTime: scheduledTime.toISOString(),
  });
  await sendScheduledMintNotification(task.userId, 'mint_scheduled', {
    taskId: task.id,
    contractAddress: task.contractAddress || undefined,
  });
  await sendMintScheduledEmail(task.userId, {
    taskId: task.id,
    contractAddress: task.contractAddress || undefined,
  });

  return updated;
}

export async function cancelScheduledMint(taskId: string, userId?: string) {
  const where = userId
    ? and(eq(mintTasks.id, taskId), eq(mintTasks.userId, userId))
    : eq(mintTasks.id, taskId);

  const [task] = await getDb().select().from(mintTasks).where(where).limit(1);
  if (!task) throw new Error('Mint task not found');

  if (task.qstashMessageId) {
    await deleteQStashMessage(task.qstashMessageId);
  }

  const [updated] = await getDb()
    .update(mintTasks)
    .set({
      status: 'cancelled',
      qstashMessageId: null,
      scheduledTime: null,
      updatedAt: new Date(),
    })
    .where(where)
    .returning();

  await logActivity(task.userId, 'task_cancelled', 'Scheduled mint cancelled', { taskId });
  return updated;
}

async function loadTaskWithWallet(taskId: string) {
  const [row] = await getDb()
    .select({ task: mintTasks, wallet: wallets })
    .from(mintTasks)
    .leftJoin(wallets, eq(mintTasks.walletId, wallets.id))
    .where(eq(mintTasks.id, taskId))
    .limit(1);

  return row ?? null;
}

function hasEnoughBalance(balance: string, mintPrice: string | null, quantity: number) {
  const balanceValue = Number(balance);
  const priceValue = Number(mintPrice ?? '0') * quantity;
  if (!Number.isFinite(balanceValue)) return false;
  return balanceValue >= priceValue;
}

export async function executeScheduledMint(taskId: string) {
  const mintLock = await acquireLock(taskId);
  if (!mintLock.acquired) {
    await captureMessage('QStash duplicate execution attempt', {
      area: 'qstash',
      level: 'warning',
      context: { taskId, lockName: mintLock.key },
      fingerprint: ['qstash', 'duplicate-execution'],
    });
    return { success: false, skipped: true, error: 'Mint task is already locked' };
  }

  let lockReleased = false;
  try {
    const row = await loadTaskWithWallet(taskId);
    if (!row?.task) throw new Error('Mint task not found');

    const { task, wallet } = row;
    if (task.status === 'completed' || task.txHash) {
      return { success: true, skipped: true, txHash: task.txHash || undefined };
    }

    if (task.status === 'cancelled') {
      return { success: false, skipped: true, error: 'Mint task was cancelled' };
    }

    if (hasBlockingRiskChange(task)) {
      return { success: false, skipped: true, error: 'Risk score changed; approval required' };
    }

    if (!wallet || !task.walletId || !task.contractAddress) {
      await getDb()
        .update(mintTasks)
        .set({ status: 'failed', qstashMessageId: null, scheduledTime: null, updatedAt: new Date() })
        .where(eq(mintTasks.id, taskId));
      await sendScheduledMintNotification(task.userId, 'mint_failed', {
        taskId,
        contractAddress: task.contractAddress || undefined,
        error: 'Scheduled mint missing wallet or contract',
      });
      await sendMintFailedEmail(task.userId, {
        taskId,
        contractAddress: task.contractAddress || undefined,
        error: 'Scheduled mint missing wallet or contract',
      });
      await sendSystemErrorEmail(task.userId, {
        taskId,
        title: 'Scheduled Mint Configuration Error',
        error: 'Scheduled mint missing wallet or contract',
      });
      return { success: false, error: 'Scheduled mint missing wallet or contract' };
    }

    if (!task.overrideRiskFlag) {
      const riskGate = await requireRiskApproval({ taskId, action: 'mint' });
      if (!riskGate.approved) {
        await getDb()
          .update(mintTasks)
          .set({ status: 'ready', qstashMessageId: null, scheduledTime: null, safeModeEnabled: true, updatedAt: new Date() })
          .where(eq(mintTasks.id, taskId));
        return {
          success: false,
          skipped: true,
          error: `Risk approval required: ${riskGate.risk?.riskScore ?? 0}/100`,
        };
      }

      const mintState = await getMintState(task.contractAddress, wallet.chain);
      if (mintState.status !== 'LIVE') {
        const retryAt = mintState.startTime && mintState.startTime.getTime() > Date.now()
          ? mintState.startTime
          : new Date(Date.now() + DEFAULT_SCHEDULE_DELAY_MS);
        await scheduleMint({ taskId, scheduledTime: retryAt });
        await logActivity(task.userId, 'mint_status_changed', 'Mint launch not live; rescheduled', {
          taskId,
          scheduledTime: retryAt.toISOString(),
          mintStatus: mintState.status,
        });
        return { success: false, skipped: true, error: `Mint not live: ${mintState.status}` };
      }
    }

    const balance = await getWalletBalance(wallet.address, wallet.chain);
    if (!hasEnoughBalance(balance.balance, task.mintPrice, task.quantity)) {
      await getDb()
        .update(mintTasks)
        .set({ status: 'failed', qstashMessageId: null, scheduledTime: null, updatedAt: new Date() })
        .where(eq(mintTasks.id, taskId));
      await logActivity(task.userId, 'mint_status_changed', 'Scheduled mint failed balance check', {
        taskId,
        balance: balance.balance,
        symbol: balance.symbol,
      });
      await sendScheduledMintNotification(task.userId, 'wallet_balance_low', {
        wallet: wallet.address,
        balance: balance.balance,
        symbol: balance.symbol,
      });
      await sendScheduledMintNotification(task.userId, 'mint_failed', {
        taskId,
        contractAddress: task.contractAddress,
        error: 'Wallet balance is too low',
      });
      await sendMintFailedEmail(task.userId, {
        taskId,
        contractAddress: task.contractAddress,
        error: 'Wallet balance is too low',
      });
      return { success: false, error: 'Wallet balance is too low' };
    }

    const [claimed] = await getDb()
      .update(mintTasks)
      .set({ status: 'ready', qstashMessageId: null, updatedAt: new Date() })
      .where(and(
        eq(mintTasks.id, taskId),
        inArray(mintTasks.status, ['pending', 'monitoring', 'ready']),
      ))
      .returning();

    if (!claimed) {
      return { success: false, skipped: true, error: 'Mint task was already claimed' };
    }

    await logActivity(task.userId, 'mint_status_changed', 'Scheduled mint triggered', { taskId });
    const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
    await trackAnalyticsEvent({
      userId: task.userId,
      eventType: 'qstash',
      status: 'executed',
      provider: 'execute',
      metadata: { taskId },
    });
    lockReleased = true;
    return executeMintTask(taskId, task.userId, { existingLockToken: mintLock.token });
  } catch (error) {
    const row = await loadTaskWithWallet(taskId).catch(() => null);
    if (row?.task?.userId) {
      await sendSystemErrorEmail(row.task.userId, {
        taskId,
        title: 'Scheduled Mint Execution Error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
    await trackAnalyticsEvent({
      eventType: 'qstash',
      status: 'failed',
      provider: 'execute',
      metadata: { taskId, error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  } finally {
    if (!lockReleased) await releaseLock(taskId, mintLock.token);
  }
}

export async function executeScheduledRiskRecheck(taskId: string) {
  return executeScheduledRiskCheck(taskId);
}
