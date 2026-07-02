import 'server-only';

import { Client, Receiver } from '@upstash/qstash';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { getWalletBalance } from '@/lib/blockchain/wallet';
import { mintTasks, wallets, collections } from '@/drizzle/schema';
import { logActivity } from '@/lib/monitoring';
import { executeMintTask } from '@/lib/services/mint.service';
import { prewarmWalletKey } from '@/lib/services/wallet.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { requireRiskApproval } from '@/lib/services/risk.service';
import { addBreadcrumb, captureMessage } from '@/lib/observability/sentry';
import { logger } from '@/lib/logger';
import { acquireLock, releaseLock } from '@/lib/services/mint-lock.service';
import { executeScheduledRiskCheck, hasBlockingRiskChange, storeOriginalRiskSnapshot } from '@/lib/services/scheduled-risk-check.service';
import { sendMintFailedEmail, sendMintScheduledEmail, sendMintSuccessEmail, sendSystemErrorEmail } from '@/lib/services/email-notification.service';
import { getClient } from '@/lib/blockchain/client';
import type { Hex } from 'viem';
import { unregisterIfIdle } from '@/lib/services/alchemy-webhook.service';
import { addTaskLog, type TaskLogEvent } from '@/lib/services/task-log.service';
import { getNativeTokenUsdPrice, formatWithUsd } from '@/lib/services/native-price.service';

// Monitoring fix: reduced from 60s to 30s.
// WebSocket monitoring watches for 25s per invocation;
// if no mint-live event is detected, we reschedule at 30s for the next window.
// Total latency: 0–2s on Base (vs 0–60s before), 0–12s on Ethereum (vs 0–60s before).
const DEFAULT_SCHEDULE_DELAY_MS = 0;

export type ScheduledMintPayload = {
  taskId: string;
  type?: 'execute' | 'risk_check' | 'receipt_check' | 'recovery';
};

function getQStashToken() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is not configured');
  return token;
}

function normalizeAppUrl(rawValue: string, envName: string) {
  const trimmed = rawValue.trim();
  if (!trimmed) throw new Error(`${envName} is empty`);

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error(`${envName} must be a valid absolute URL or hostname`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${envName} must use http:// or https://`);
  }

  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error(`${envName} must be an origin URL without credentials, query, or hash`);
  }

  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(`${envName} must not include a path`);
  }

  return parsed.origin;
}

function resolveWebhookSource(): { url: string; envName: string } {
  const candidates = [
    ['APP_URL', process.env.APP_URL],
    ['NEXT_PUBLIC_APP_URL', process.env.NEXT_PUBLIC_APP_URL],
    // VERCEL_PROJECT_PRODUCTION_URL is the STABLE production domain (e.g.
    // my-app.vercel.app), auto-set by Vercel in every deployment. It is public
    // and identical across deploys — unlike VERCEL_URL which is the ephemeral
    // per-deployment URL that's often blocked by Deployment Protection and
    // breaks QStash signature verification. Prefer it over VERCEL_URL.
    ['VERCEL_PROJECT_PRODUCTION_URL', process.env.VERCEL_PROJECT_PRODUCTION_URL],
    ['VERCEL_URL', process.env.VERCEL_URL],
  ] as const;

  for (const [envName, value] of candidates) {
    if (!value) continue;
    return { url: `${normalizeAppUrl(value, envName)}/api/webhooks/qstash`, envName };
  }

  throw new Error('APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL is required');
}

function getWebhookUrl() {
  return resolveWebhookSource().url;
}



function secondsFromDate(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Returns true when scheduledTime is "right now" — i.e. the caller wants
 * immediate delivery and should NOT send an Upstash-Not-Before header.
 * Using Not-Before: now+1 forces a minimum 1s queue delay for live mints;
 * omitting the header entirely lets QStash deliver as fast as possible.
 */
function isImmediateDelivery(date: Date): boolean {
  // Treat any date within 2 seconds of now as "immediate"
  return date.getTime() <= Date.now() + 2_000;
}




export async function verifyQStashSignature(headers: Headers, rawBody: string) {
  const signature = headers.get('upstash-signature');
  if (!signature) throw new Error('Missing QStash signature');

  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey    = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentKey) throw new Error('QStash signing keys are not configured');

  // Verifies: HMAC-SHA256 signature, exp, nbf, body hash, and sub claim
  // (URL match — equivalent to the C-7 cross-endpoint replay fix).
  const receiver = new Receiver({
    currentSigningKey: currentKey,
    nextSigningKey: nextKey ?? currentKey,
  });
  await receiver.verify({ signature, body: rawBody, url: getWebhookUrl() });
}

function getQStashClient() {
  return new Client({ token: getQStashToken() });
}

async function publishQStashMessage(
  taskId: string,
  scheduledTime: Date,
  type: ScheduledMintPayload['type'] = 'execute',
) {
  addBreadcrumb({ category: 'qstash', message: 'scheduling started', level: 'info',
    data: { taskId, scheduledTime: scheduledTime.toISOString(), type } });

  const result = await getQStashClient().publishJSON({
    url: getWebhookUrl(),
    body: { taskId, type } satisfies ScheduledMintPayload,
    // Speed fix: omit notBefore for immediate delivery so QStash fires ASAP.
    // For future-scheduled mints pass the unix-seconds timestamp.
    ...(!isImmediateDelivery(scheduledTime) && { notBefore: secondsFromDate(scheduledTime) }),
  });

  const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
  await trackAnalyticsEvent({ eventType: 'qstash', status: 'scheduled', provider: type,
    metadata: { taskId, scheduledTime: scheduledTime.toISOString(), messageId: result.messageId } });

  return result;
}


function getRiskCheckTime(scheduledTime: Date) {
  const oneHourBefore = new Date(scheduledTime.getTime() - 60 * 60 * 1000);
  return oneHourBefore.getTime() > Date.now() ? oneHourBefore : undefined;
}

async function deleteQStashMessage(messageId: string) {
  try {
    await getQStashClient().messages.delete(messageId);
  } catch (error) {
    // 404 = already delivered / cancelled — not an error
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('404') && !msg.toLowerCase().includes('not found')) throw error;
  }
}

async function sendScheduledMintNotification(
  userId: string,
  type: 'mint_scheduled' | 'mint_failed' | 'wallet_balance_low' | 'mint_live_detected' | 'mint_executing',
  payload: {
    taskId?: string;
    collectionName?: string;
    contractAddress?: string;
    wallet?: string;
    error?: string;
    balance?: string;
    symbol?: string;
    mintPrice?: string;
    detail?: string;
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
  /** Override the DB status set when the QStash message is enqueued.
   *  Defaults to 'monitoring'. Pass 'ready' when the mint is already
   *  live so the UI shows the correct state instead of "monitoring". */
  initialStatus?: 'monitoring' | 'ready';
}) {
  const [task] = await getDb().select().from(mintTasks).where(eq(mintTasks.id, params.taskId)).limit(1);
  if (!task) throw new Error('Mint task not found');
  if (params.userId && task.userId !== params.userId) throw new Error('Mint task not found');
  if (task.status === 'completed' || task.status === 'running') return task;

  const overrideRiskFlag = params.overrideRiskFlag ?? task.overrideRiskFlag ?? false;

  // ── Live vs. scheduled risk-scoring policy (intentional) ──────────────────
  // Live/instant mints (initialStatus: 'ready') execute immediately — there is
  // no safe window to delay execution for a synchronous risk analysis, so they
  // deliberately skip the pre-flight risk gate AND the original-risk snapshot
  // below. This matches executeMintTask()'s execution-time gate
  // (requireRiskApproval({ action: 'mint' })), which auto-approves an unscored
  // task by design for exactly this path — see risk.service.ts.
  // Scheduled/upcoming mints (initialStatus: 'monitoring', the default) DO get
  // risk-scored here before the QStash message is published, and get a
  // one-hour-before recheck via getRiskCheckTime().
  const isLiveMint = (params.initialStatus ?? 'monitoring') === 'ready';

  if (!overrideRiskFlag && !isLiveMint) {
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

  // Live mints: no snapshot, no pre-execution recheck — nothing to "recheck"
  // for a mint that's already executing now. Scheduled mints: score now and
  // arm the one-hour-before recheck as before.
  let originalRisk: { riskScore: number | null; riskReasons: string[] } = { riskScore: null, riskReasons: [] };
  if (!isLiveMint) {
    originalRisk = await storeOriginalRiskSnapshot(task.id);
    const riskCheckTime = getRiskCheckTime(scheduledTime);
    if (riskCheckTime && !overrideRiskFlag) {
      await publishQStashMessage(task.id, riskCheckTime, 'risk_check');
    }
  }

  const qstash = await publishQStashMessage(task.id, scheduledTime, 'execute');
  const qstashMessageId = qstash.messageId || (qstash as unknown as { scheduleId?: string }).scheduleId;
  if (!qstashMessageId) throw new Error('QStash response did not include a message id');
  addBreadcrumb({
    category: 'qstash',
    message: 'scheduling completed',
    level: 'info',
    data: { taskId: task.id, qstashMessageId, scheduledTime: scheduledTime.toISOString() },
  });
  const effectiveStatus = params.initialStatus ?? 'monitoring';
  // Diagnostic: surface the exact webhook URL QStash will POST back to, and warn
  // when it resolves to the ephemeral VERCEL_URL (deployment-specific, often
  // blocked by Vercel Deployment Protection — set APP_URL to your stable domain).
  const { url: webhookUrl, envName: webhookEnv } = resolveWebhookSource();
  await addTaskLog(task.id, 'qstash_published', 'info',
    `QStash message published — ${effectiveStatus === 'ready' ? 'executing immediately' : 'monitoring for mint start'} → ${webhookUrl}`);
  if (webhookEnv === 'VERCEL_URL') {
    await addTaskLog(task.id, 'qstash_published', 'warning',
      'Webhook URL resolved from VERCEL_URL (ephemeral, may be blocked by Vercel Deployment Protection). Set APP_URL to your stable domain.');
  }
  const [updated] = await getDb()
    .update(mintTasks)
    .set({
      status: effectiveStatus,
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
  // ── Telegram/email notification policy ───────────────────────────────────
  // A LIVE mint (effectiveStatus === 'ready') executes immediately and
  // executeMintTask() sends the "⚡ Mint Executing" message a moment later, so a
  // separate "live detected" message here would be redundant. We only notify on
  // scheduling for FUTURE mints, where there is a real gap before execution.
  // This keeps the message count tight:
  //   LIVE      → ⚡ Executing → ✅/❌ Result          (2 messages)
  //   Upcoming  → 🕐 Scheduled → ⚡ Executing → Result  (3 messages)
  if (effectiveStatus !== 'ready') {
    await sendScheduledMintNotification(task.userId, 'mint_scheduled', {
      taskId: task.id,
      contractAddress: task.contractAddress || undefined,
    });
    await sendMintScheduledEmail(task.userId, {
      taskId: task.id,
      contractAddress: task.contractAddress || undefined,
    });
  }

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

// M-03 Fix: loadTaskWithWallet now accepts an optional userId.
// When provided, it is added to the WHERE clause so a replayed QStash message
// carrying a foreign taskId cannot execute another user's mint.
// QStash payloads are HMAC-signed, but defence-in-depth still applies.
async function loadTaskWithWallet(taskId: string, userId?: string) {
  const whereClause = userId
    ? and(eq(mintTasks.id, taskId), eq(mintTasks.userId, userId))
    : eq(mintTasks.id, taskId);

  const [row] = await getDb()
    .select({ task: mintTasks, wallet: wallets, collection: collections })
    .from(mintTasks)
    .leftJoin(wallets, eq(mintTasks.walletId, wallets.id))
    .leftJoin(collections, eq(mintTasks.collectionId, collections.id))
    .where(whereClause)
    .limit(1);

  return row ?? null;
}

/**
 * H-3 fix: balance unit normalisation.
 *
 * `balance` comes from getWalletBalance → formatEther → ETH string e.g. "0.05"
 * `mintPrice` comes from fetchMintRequirements which divides priceWei by 1e18
 * and calls .toFixed(6), so it is also in ETH e.g. "0.050000".
 *
 * Both sides are already in ETH — the comparison is safe.
 * This guard makes the contract explicit and adds a Wei-detection safety net:
 * if mintPrice looks like it is in Wei (>= 1e9, i.e. at least 1 Gwei), we
 * normalise it to ETH before comparing so the check never silently blocks a
 * wallet that actually has enough funds.
 */
function hasEnoughBalance(balance: string, mintPrice: string | null, quantity: number) {
  const balanceValue = Number(balance); // ETH units from formatEther
  if (!Number.isFinite(balanceValue)) return false;

  let priceEth = Number(mintPrice ?? '0');
  if (!Number.isFinite(priceEth)) return true; // can't determine price → allow

  // Safety net: if the stored value looks like Wei (>= 1e9 = 1 Gwei) convert it.
  // fetchMintRequirements always stores in ETH, but historical or manually-set
  // records might carry Wei values. Normalise defensively.
  if (priceEth >= 1e9) {
    priceEth = priceEth / 1e18;
  }

  return balanceValue >= priceEth * quantity;
}

// ——— Retry classification ———————————————————————————————————————————————
//
// Only transient infrastructure failures are retried.
// Terminal errors (sold out, mint closed, insufficient funds, bad contract,
// missing wallet, user-cancelled) must not be retried — they will always fail.

const RETRYABLE_PATTERNS = [
  'rpc',
  'timeout',
  'network',
  'econnreset',
  'econnrefused',
  'fetch failed',
  'socket',
  'rate limit',
  '429',
  '503',
  '502',
  'temporary',
  'nonce',
  'underpriced',
  'gas estimation',
];

const TERMINAL_PATTERNS = [
  'sold out',
  'max supply',
  'mint ended',
  'mint closed',
  'not started',
  'already ended',
  'insufficient funds',
  'invalid contract',
  'wallet not found',
  'wallet key unavailable',
  'wallet not linked',
  'cancelled',
  'access denied',
  // C-04: receipt_timeout means the transaction IS on-chain — executeMintTask
  // has already set status='unconfirmed' and scheduled a receipt recheck.
  // This error must never be classified as retryable.
  'receipt_timeout',
  // 'unconfirmed' is the status string returned by executeMintTask when txHash
  // exists. Treat as terminal at the retry layer for the same reason.
  'unconfirmed',
];

function isRetryableError(error: string | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  if (TERMINAL_PATTERNS.some((p) => lower.includes(p))) return false;
  return RETRYABLE_PATTERNS.some((p) => lower.includes(p));
}

// Transient-error retry policy.
// 2s base so the first retry fires near-instantly (~2-3s end-to-end including
// QStash delivery), doubling each attempt (2s, 4s, 8s, 16s ...), capped at
// 10 min. Most transient mint failures (RPC blip, nonce-too-low, gas estimate
// races) clear on the very next attempt — keeping the first delay tiny is the
// difference between "missed the mint" and "got in on the retry".
const RETRY_BASE_DELAY_MS = 2_000;

function retryDelayMs(retriesRemaining: number, maxRetries: number): number {
  const attempt = maxRetries - retriesRemaining + 1;
  return Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), 10 * 60 * 1000); // cap at 10 min
}

export async function executeScheduledMint(taskId: string) {
  await addTaskLog(taskId, 'qstash_received', 'info', 'QStash webhook received — starting execution pipeline');
  // H1 fix: capture the lock token so the release uses the atomic Lua CAS path.
  const lockToken = (await acquireLock(taskId)) ?? undefined;
  if (!lockToken) {
    await captureMessage('QStash duplicate execution attempt', {
      area: 'qstash',
      level: 'warning',
      context: { taskId },
      fingerprint: ['qstash', 'duplicate-execution'],
    });
    return { success: false, skipped: true, error: 'Mint task is already locked' };
  }

  let lockReleased = false;
  try {
    const row = await loadTaskWithWallet(taskId);
    if (!row?.task) throw new Error('Mint task not found');

    const { task, wallet, collection } = row;
    const collectionName = collection?.name || undefined;
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
        collectionName,
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
      // Speed fix: requireRiskApproval() issues a fresh DB SELECT on mintTasks,
      // but we already have the task from loadTaskWithWallet() above.
      // If riskScore is stored and below the threshold — and hasBlockingRiskChange()
      // already returned false (risk hasn't jumped by >20 points) — the full call
      // will always approve. Skip the DB round-trip and inline the comparison.
      //
      // Only fall through to requireRiskApproval() when risk is high or unknown,
      // which preserves the full Telegram approval gate for those cases.
      const storedRiskScore = typeof task.riskScore === 'number' ? task.riskScore : null;
      const riskThreshold   = task.riskThreshold ?? 75;
      const riskClearlyApproved = storedRiskScore !== null && storedRiskScore <= riskThreshold;

      if (!riskClearlyApproved) {
        // Risk is high or has no stored score — run the full approval gate
        // (may send Telegram notification requesting manual approval)
        const riskGate = await requireRiskApproval({ taskId, action: 'mint' });
        if (!riskGate.approved) {
          await addTaskLog(taskId, 'risk_check_blocked', 'warning', `Risk approval required: ${riskGate.risk?.riskScore ?? 0}/100`);
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
        await addTaskLog(taskId, 'risk_check_passed', 'success', 'Risk check passed');
      }

      const mintState = await getMintState(task.contractAddress, wallet.chain);
      await addTaskLog(taskId, 'mint_state_check', 'info', `Mint state: ${mintState.status}`);
      // H2: only NOT_STARTED and ENDED enter the watch/reschedule branch.
      // UNKNOWN (contract exposes no readable state getters — common for custom
      // or proxy mints, and on Base/Polygon where there's no OpenSea fallback)
      // now falls through to execution. The pre-broadcast eth_call simulation is
      // the gate: it will cleanly classify wrong_phase / sold_out / paused if the
      // mint truly isn't open, instead of the task failing forever as "not live".
      if (mintState.status === 'NOT_STARTED' || mintState.status === 'ENDED') {
        // H-5 fix: cap reschedule attempts to prevent infinite QStash billing.
        // We repurpose maxRetries as a unified attempt counter — each reschedule
        // for a NOT_STARTED mint decrements it by 1.  When it reaches 0 we mark
        // the task failed instead of scheduling another QStash message.
        const remainingRetries = (task.maxRetries ?? 0) - 1;

        if (remainingRetries <= 0 || mintState.status === 'ENDED') {
          await getDb()
            .update(mintTasks)
            .set({ status: 'failed', qstashMessageId: null, scheduledTime: null, updatedAt: new Date() })
            .where(eq(mintTasks.id, taskId));
          // Cleanup: mint ended — unregister from Alchemy webhook
          if (task.contractAddress) {
            void unregisterIfIdle(task.contractAddress, taskId).catch(() => {});
          }
          await sendScheduledMintNotification(task.userId, 'mint_failed', {
            taskId,
            collectionName,
            contractAddress: task.contractAddress || undefined,
            error: mintState.status === 'ENDED'
              ? 'Mint has ended'
              : 'Mint never went live — max reschedule attempts exhausted',
          });
          await sendMintFailedEmail(task.userId, {
            taskId,
            contractAddress: task.contractAddress || undefined,
            error: mintState.status === 'ENDED'
              ? 'Mint has ended'
              : 'Mint never went live — max reschedule attempts exhausted',
          });
          return { success: false, error: `Mint not live (${mintState.status}): max retries exhausted` };
        }

        // Monitoring fix: instead of blind 60s reschedule, use WebSocket block
        // subscription to detect when the mint goes live within a 25s window.
        // On each new block, getMintState() is called — a mint can only become
        // LIVE on a block boundary, so this is both faster and more efficient.
        //
        // Detection latency improvement:
        //   Base (2s blocks):      0–2s   (was 0–60s, 30× faster)
        //   Ethereum (12s blocks): 0–12s  (was 0–60s,  5× faster)
        const { watchForMintLive } = await import('@/lib/services/mint-monitor.service');
        await addTaskLog(taskId, 'websocket_monitoring', 'info', 'WebSocket block monitoring started — watching for mint-live event');
        const monitorResult = await watchForMintLive(
          task.contractAddress!,
          wallet.chain,
        );

        if (monitorResult === 'live') {
          await addTaskLog(taskId, 'websocket_live_detected', 'success', 'Mint went live during watch window — executing immediately');
          // Mint went live during the watch window — execute immediately.
          // Don't reschedule — fall through to the execution path below.
          addBreadcrumb({
            category: 'qstash',
            message: 'WebSocket monitor detected mint-live — executing immediately',
            level: 'info',
            data: { taskId, contractAddress: task.contractAddress },
          });
          // Don't notify here — executeMintTask() (reached by falling through
          // below) sends the "⚡ Mint Executing" message, avoiding a redundant
          // "live detected" notification right before it.
          // Update retry counter and fall through to execution
          await getDb()
            .update(mintTasks)
            .set({ maxRetries: remainingRetries, updatedAt: new Date() })
            .where(eq(mintTasks.id, taskId));
          // Don't return — fall through to the balance check + execution below
        } else {
          // timeout or error — reschedule for next watch window
          if (monitorResult === 'ended') {
            await getDb()
              .update(mintTasks)
              .set({ status: 'failed', qstashMessageId: null, scheduledTime: null, updatedAt: new Date() })
              .where(eq(mintTasks.id, taskId));
            return { success: false, skipped: true, error: 'Mint ended while monitoring' };
          }

          // Decrement the retry counter before rescheduling
          await getDb()
            .update(mintTasks)
            .set({ maxRetries: remainingRetries, updatedAt: new Date() })
            .where(eq(mintTasks.id, taskId));

          const retryAt = mintState.startTime && mintState.startTime.getTime() > Date.now()
            ? mintState.startTime
            : new Date(Date.now() + DEFAULT_SCHEDULE_DELAY_MS);
          await scheduleMint({ taskId, scheduledTime: retryAt });
          await logActivity(task.userId, 'mint_status_changed', 'Mint not live; rescheduled for next watch window', {
            taskId,
            scheduledTime: retryAt.toISOString(),
            mintStatus: mintState.status,
            monitorResult,
            retriesRemaining: remainingRetries,
          });
          return { success: false, skipped: true, error: `Mint not live: ${mintState.status}` };
        }
      } else if (mintState.status === 'UNKNOWN') {
        // H2: state unreadable on-chain — proceed to execution; simulation gates it.
        await addTaskLog(taskId, 'mint_state_unknown' as TaskLogEvent, 'info', 'Mint state UNKNOWN — attempting mint; pre-broadcast simulation will gate eligibility');
      }
    }

    // ── Live price re-fetch ──────────────────────────────────────────────────
    // The stored mintPrice was fetched at task-creation time. The project owner
    // may have changed the price (or made it free) between then and now.
    // Re-read publicMintPrice() on-chain (fast RPC call, ~100ms) so the balance
    // check and transaction use the CURRENT contract price, not a stale one.
    // A wrong price would cause an on-chain revert and waste the user's gas.
    let effectiveMintPrice: string | null = task.mintPrice;
    try {
      const { fetchMintRequirements } = await import('@/lib/services/mint-requirements.service');
      const liveReqs = await fetchMintRequirements(task.contractAddress!, wallet.chain);
      const livePrice = liveReqs.mintPrice;
      await addTaskLog(taskId, 'price_refetch', 'info', 'Re-fetching live mint price from on-chain');

      // Only act on a live price we could actually read. A null livePrice means
      // the contract has no on-chain price getter (e.g. OpenSea / SeaDrop drops)
      // — keep the stored price (set from off-chain discovery at creation) rather
      // than overwriting it with "unknown".
      if (livePrice != null && livePrice !== task.mintPrice) {
        await addTaskLog(taskId, 'price_changed', 'warning', `Mint price changed: ${task.mintPrice} → ${livePrice}`);
        addBreadcrumb({
          category: 'qstash',
          message: 'Mint price changed since task creation — updating task',
          level: 'warning',
          data: { taskId, oldPrice: task.mintPrice, newPrice: livePrice },
        });

        await getDb()
          .update(mintTasks)
          .set({ mintPrice: livePrice, updatedAt: new Date() })
          .where(eq(mintTasks.id, taskId));

        // Log price change — user will see updated price reflected in the task
        logger.info('Mint price updated from on-chain re-fetch', {
          area: 'qstash/execute',
          taskId,
          oldPrice: task.mintPrice,
          newPrice: livePrice,
        });

        // Use fresh price for the balance check below
        effectiveMintPrice = livePrice;
      }
    } catch {
      // Non-fatal: if the on-chain read fails, fall back to the stored price.
      // The simulation inside executeMintTask() will catch any mismatch before
      // the real transaction is sent.
      addBreadcrumb({
        category: 'qstash',
        message: 'Live price re-fetch failed — using stored price as fallback',
        level: 'warning',
        data: { taskId, storedPrice: task.mintPrice },
      });
    }

    // Block when the mint price is still unknown. Proceeding with an implicit 0
    // would (a) make the balance check pass for an empty wallet and (b) simulate
    // mint() with 0 value, which reverts on underpayment and is misreported as a
    // honeypot. Fail clearly instead so the user can set the price manually.
    if (effectiveMintPrice == null) {
      await addTaskLog(taskId, 'price_unknown', 'error', 'Could not determine mint price — no on-chain price getter and off-chain discovery was unavailable. Task blocked to avoid a 0-value mint. Set the mint price manually and retry.');
      await getDb()
        .update(mintTasks)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(mintTasks.id, taskId));
      await sendScheduledMintNotification(task.userId, 'mint_failed', {
        taskId,
        collectionName,
        contractAddress: task.contractAddress,
        error: 'Mint price could not be determined',
      });
      await sendMintFailedEmail(task.userId, {
        taskId,
        contractAddress: task.contractAddress,
        error: 'Mint price could not be determined',
      });
      return { success: false, error: 'Mint price could not be determined' };
    }

    // ── Notify execution start ────────────────────────────────────────────────
    // Fire "⚡ Mint Executing" HERE — once the mint is confirmed live and the
    // price is resolved, but BEFORE the balance/pre-flight gates that can fail.
    // Previously this lived inside executeMintTask(), which the balance check
    // below returns before reaching, so a low-balance mint only ever showed
    // "❌ Mint Failed" with no preceding "⚡ Executing". executeMintTask() is
    // called with notifyStarted:false below to avoid a duplicate on success.
    await sendScheduledMintNotification(task.userId, 'mint_executing', {
      taskId,
      collectionName,
      contractAddress: task.contractAddress || undefined,
      mintPrice: effectiveMintPrice || undefined,
    });

    const balance = await getWalletBalance(wallet.address, wallet.chain);
    if (!hasEnoughBalance(balance.balance, effectiveMintPrice, task.quantity)) {
      // Show both what the wallet has and what the mint needs in ETH + USD so
      // the user knows exactly how much money to add. Also trims the ugly long
      // balance decimal (e.g. 0.000082664711775296 → 0.000083).
      const usdPrice = await getNativeTokenUsdPrice(wallet.chain).catch(() => 0);
      const mintCostEth = Number(effectiveMintPrice) * task.quantity;
      const haveStr = usdPrice ? formatWithUsd(balance.balance, balance.symbol, usdPrice) : `${balance.balance} ${balance.symbol}`;
      const costStr = usdPrice ? formatWithUsd(mintCostEth, balance.symbol, usdPrice) : `${mintCostEth} ${balance.symbol}`;
      await addTaskLog(taskId, 'balance_check_failed', 'error', `Insufficient balance: have ${haveStr}, mint costs ${costStr} + gas. Fund the wallet and retry.`);
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
        balance: balance.balance ?? undefined,
        symbol: balance.symbol ?? undefined,
      });
      await sendScheduledMintNotification(task.userId, 'mint_failed', {
        taskId,
        collectionName,
        contractAddress: task.contractAddress,
        mintPrice: effectiveMintPrice || undefined,
        error: 'Wallet balance is too low',
        detail: `Have ${haveStr}, need ${costStr} + gas`,
      });
      await sendMintFailedEmail(task.userId, {
        taskId,
        contractAddress: task.contractAddress,
        error: 'Wallet balance is too low',
      });
      return { success: false, error: 'Wallet balance is too low' };
    }
    await addTaskLog(taskId, 'balance_check_passed', 'success', `Balance check passed: ${balance.balance} ${balance.symbol}`);

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
    // H1 fix: hand the lock token off to executeMintTask so it does NOT re-acquire
    // the lock we already hold (the previous empty-options call re-acquired and
    // failed). executeMintTask now owns the release; lockReleased=true stops this
    // function's finally from double-releasing.
    lockReleased = true;

    // ── Honeypot check ───────────────────────────────────────────────────────
    // Simulate the mint function on-chain before submitting the real TX.
    // If the contract reverts in simulation it's likely a honeypot or misconfigured
    // contract — abort early and save the user's gas.
    if (task.contractAddress && wallet) {
      const { checkHoneypot } = await import('@/lib/services/honeypot.service');
      const honeypot = await checkHoneypot({
        contractAddress: task.contractAddress,
        chain:           wallet.chain,
        mintFunction:    task.mintFunction ?? 'mint',
        // Guaranteed non-null here: the unknown-price guard above already blocked.
        mintPrice:       effectiveMintPrice,
        quantity:        task.quantity,
        walletAddress:   wallet.address,
      });

      if (!honeypot.isSafe && !honeypot.skipped) {
        await addTaskLog(taskId, 'honeypot_check_failed', 'error', `Honeypot detected: ${honeypot.reason}`);
        await getDb()
          .update(mintTasks)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(mintTasks.id, taskId));
        await sendScheduledMintNotification(task.userId, 'mint_failed', {
          taskId,
          contractAddress: task.contractAddress,
          error: honeypot.reason ?? 'Honeypot detected — mint simulation reverted',
        });
        await sendMintFailedEmail(task.userId, {
          taskId,
          contractAddress: task.contractAddress,
          error: honeypot.reason ?? 'Honeypot detected — mint simulation reverted',
        });
        return { success: false, error: honeypot.reason ?? 'Honeypot detected' };
      }
      await addTaskLog(taskId, 'honeypot_check_passed', 'success', 'Honeypot simulation passed — contract is safe');
    }

    // Speed fix: fire-and-forget wallet key pre-warm so the decryption cache is
    // hot by the time executeMintTask reaches getDecryptedPrivateKey().
    // This runs concurrently with executeMintTask's internal DB status claims.
    if (task.walletId) {
      void prewarmWalletKey(task.walletId, task.userId).catch(() => undefined);
    }
    await addTaskLog(taskId, 'tx_submitting', 'info', 'Submitting mint transaction to blockchain');
    const mintResult = await executeMintTask(taskId, task.userId, {
      existingLockToken: lockToken,
      // The "⚡ Mint Executing" message was already sent above (before the
      // balance gate), so suppress the duplicate inside executeMintTask.
      notifyStarted: false,
      // Pass the resolved collection name so success/failure messages from
      // executeMintTask also show it instead of the raw contract address.
      collectionName,
    });
    await addTaskLog(taskId, mintResult.txHash ? 'tx_submitted' : 'task_completed', mintResult.success ? 'success' : 'error', mintResult.txHash ? `Transaction submitted: ${mintResult.txHash}` : mintResult.error ?? 'Unknown error');

    // ——— Retry on transient failure ——————————————————————————————
    // C-04: NEVER retry if a txHash is present — the transaction is already
    // on-chain and executeMintTask has transitioned the task to 'unconfirmed'.
    // Retrying here would call sendTransaction a second time.
    if (!mintResult.success && !mintResult.txHash && isRetryableError(mintResult.error)) {
      const currentTask = (await getDb()
        .select({ maxRetries: mintTasks.maxRetries })
        .from(mintTasks)
        .where(eq(mintTasks.id, taskId))
        .limit(1))[0];

      const retriesRemaining = currentTask?.maxRetries ?? 0;

      if (retriesRemaining > 0) {
        const delay = retryDelayMs(retriesRemaining, task.maxRetries);
        const retryAt = new Date(Date.now() + delay);

        await getDb()
          .update(mintTasks)
          .set({ maxRetries: retriesRemaining - 1, status: 'pending', updatedAt: new Date() })
          .where(eq(mintTasks.id, taskId));

        await publishQStashMessage(taskId, retryAt, 'execute');

        await addTaskLog(taskId, 'task_retrying', 'warning', `Retrying in ${Math.round(delay/1000)}s (${retriesRemaining - 1} retries left)`);
        addBreadcrumb({
          category: 'qstash',
          message: 'mint retry scheduled',
          level: 'warning',
          data: { taskId, retriesRemaining: retriesRemaining - 1, retryAt: retryAt.toISOString(), error: mintResult.error },
        });

        return { success: false, retrying: true, retriesRemaining: retriesRemaining - 1, error: mintResult.error };
      }

      // Retries exhausted — already failed by executeMintTask, nothing more to do
      addBreadcrumb({
        category: 'qstash',
        message: 'mint retries exhausted',
        level: 'error',
        data: { taskId, error: mintResult.error },
      });
    }

    return mintResult;
  } catch (error) {
    // Surface unexpected errors in the task console so the user sees a reason
    // instead of a task silently stuck in "running". Specific failure paths
    // above already log their own reason; this catches everything else.
    const errMessage = error instanceof Error ? error.message : String(error);
    await addTaskLog(taskId, 'task_failed', 'error', `Execution error: ${errMessage}`).catch(() => {});
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
    if (!lockReleased) await releaseLock(taskId, lockToken);
  }
}

export async function executeScheduledRiskRecheck(taskId: string) {
  return executeScheduledRiskCheck(taskId);
}

// ── C-04: Receipt recheck ─────────────────────────────────────────────────
//
// When waitForTransactionReceipt times out after a successful broadcast,
// executeMintTask sets status='unconfirmed' and calls scheduleReceiptRecheck.
// QStash delivers to /api/webhooks/qstash with type='receipt_check'.
// executeReceiptRecheck polls the chain for the known txHash and transitions
// the task to 'completed' if confirmed — without ever calling sendTransaction.
//
// Retry budget: RECEIPT_RECHECK_MAX_ATTEMPTS checks, RECEIPT_RECHECK_DELAY_MS apart.
// After exhaustion the task stays 'unconfirmed' for manual review.

const RECEIPT_RECHECK_DELAY_MS = 30_000;     // 30 s between receipt checks

export async function scheduleReceiptRecheck(taskId: string, txHash: string) {
  addBreadcrumb({
    category: 'qstash',
    message: 'receipt recheck scheduled',
    level: 'info',
    data: { taskId, txHash },
  });
  const recheckAt = new Date(Date.now() + RECEIPT_RECHECK_DELAY_MS);
  await publishQStashMessage(taskId, recheckAt, 'receipt_check');
}

export async function executeReceiptRecheck(taskId: string) {
  const [task] = await getDb()
    .select()
    .from(mintTasks)
    .where(eq(mintTasks.id, taskId))
    .limit(1);

  if (!task) {
    return { success: false, error: 'Task not found' };
  }

  // Guard: only process tasks that are actually unconfirmed with a known txHash
  if (task.status !== 'unconfirmed') {
    return { success: true, skipped: true, reason: `Task status is '${task.status}'; no receipt check needed` };
  }

  if (!task.txHash) {
    // Defensive: should not happen — log and do nothing
    await captureMessage('receipt_check fired for task with no txHash', {
      area: 'qstash',
      level: 'error',
      context: { taskId },
      fingerprint: ['qstash', 'receipt-check-no-hash'],
    });
    return { success: false, error: 'No txHash on unconfirmed task' };
  }

  const hash = task.txHash as Hex;

  // Load the wallet to get the chain
  const [wallet] = task.walletId
    ? await getDb().select().from(wallets).where(eq(wallets.id, task.walletId)).limit(1)
    : [];

  if (!wallet) {
    return { success: false, error: 'Wallet not found for receipt recheck' };
  }

  // Reliability fix (R-4): check if the transaction is still in the mempool
  // BEFORE waiting for a receipt.
  //
  // getTransaction(hash) returns the tx object if it's pending or confirmed.
  // It returns null if the transaction was DROPPED from the mempool.
  //
  // getTransactionReceipt cannot distinguish "dropped" from "pending" — both
  // return null. We need getTransaction to detect the dropped case.
  //
  // When a tx is dropped (gas too low, nonce replaced, RPC eviction):
  //   - It will NEVER confirm on-chain
  //   - Re-executing is safe — the original tx no longer exists
  //   - We reset txHash to null and re-schedule for fresh execution
  try {
    const dropCheckClient = getClient(wallet.chain, task.userId);
    const txRecord = await dropCheckClient.getTransaction({ hash }).catch(() => null);

    if (!txRecord) {
      // Transaction is not in the mempool — it was dropped.
      // Safely reset to 'ready' and re-schedule for fresh execution.
      await getDb()
        .update(mintTasks)
        .set({ status: 'ready', txHash: null, updatedAt: new Date() })
        .where(and(eq(mintTasks.id, taskId), eq(mintTasks.status, 'unconfirmed')));

      await captureMessage('Transaction dropped from mempool — resetting for re-execution', {
        area: 'qstash',
        level: 'warning',
        context: { taskId, transactionHash: hash },
        fingerprint: ['qstash', 'tx-dropped'],
      });

      await logActivity(task.userId, 'mint_status_changed', 'Dropped transaction detected — rescheduling', {
        taskId, txHash: hash,
      });

      // Re-schedule immediately via QStash
      await scheduleMint({ taskId, userId: task.userId });

      addBreadcrumb({
        category: 'qstash',
        message: 'receipt recheck: dropped tx detected — rescheduled for execution',
        level: 'warning',
        data: { taskId, txHash: hash },
      });

      return { success: false, dropped: true, txHash: hash };
    }
  } catch (dropCheckError) {
    // Drop-check failed — proceed with waitForTransactionReceipt anyway.
    // Non-fatal: if the tx is truly dropped, future rechecks will catch it.
    addBreadcrumb({
      category: 'qstash',
      message: 'receipt recheck: drop-check failed (non-fatal)',
      level: 'warning',
      data: { taskId, error: String(dropCheckError) },
    });
  }

  try {
    const client = getClient(wallet.chain, task.userId);
    const receipt = await client.waitForTransactionReceipt({ hash });

    const now = new Date();
    const confirmed = receipt.status === 'success';

    await getDb()
      .update(mintTasks)
      .set({
        status: 'completed',
        txHash: hash,
        confirmedAt: confirmed ? now : null,
        updatedAt: now,
      })
      .where(
        // Only update if still unconfirmed — prevents a race with any concurrent check
        and(eq(mintTasks.id, taskId), eq(mintTasks.status, 'unconfirmed')),
      );

    if (!confirmed) {
      await captureMessage('Unconfirmed mint transaction reverted on recheck', {
        area: 'qstash',
        level: 'error',
        context: { taskId, transactionHash: hash },
        fingerprint: ['qstash', 'receipt-reverted'],
      });
    }

    await logActivity(task.userId, 'task_completed', 'Unconfirmed mint confirmed on recheck', {
      taskId,
      txHash: hash,
    });

    if (confirmed) {
      await sendMintSuccessEmail(task.userId, {
        taskId,
        txHash: hash,
        status: 'Confirmed (recheck)',
      });
    }

    addBreadcrumb({
      category: 'qstash',
      message: 'receipt recheck: confirmed',
      level: 'info',
      data: { taskId, txHash: hash, status: receipt.status },
    });

    return { success: confirmed, txHash: hash };

  } catch {
    // Receipt still not available — reschedule if budget remains.
    // CRIT-02: Dedicated column for receipt recheck budget (not maxRetries).
    const recheckAttemptsRemaining = task.receiptRecheckAttempts ?? 10;

    if (recheckAttemptsRemaining > 0) {
      const delay = RECEIPT_RECHECK_DELAY_MS;
      const recheckAt = new Date(Date.now() + delay);

      await getDb()
        .update(mintTasks)
        .set({ receiptRecheckAttempts: recheckAttemptsRemaining - 1, updatedAt: new Date() })
        .where(and(eq(mintTasks.id, taskId), eq(mintTasks.status, 'unconfirmed')));

      // Speed fix (gas bump): at the halfway point of the recheck budget,
      // attempt to replace the stuck transaction with a higher-gas version.
      // This uses the same nonce, so only one transaction can ever confirm.
      // We fire this best-effort — a bump failure never blocks the recheck.
      const TOTAL_RECHECK_BUDGET = 10;
      const BUMP_AT_REMAINING = Math.floor(TOTAL_RECHECK_BUDGET / 2); // halfway = 5
      if (recheckAttemptsRemaining === BUMP_AT_REMAINING && task.walletId) {
        void (async () => {
          try {
            const { getDecryptedPrivateKey } = await import('@/lib/services/wallet.service');
            const { privateKeyToAccount } = await import('viem/accounts');
            const { bumpTransactionGas } = await import('@/lib/services/rpc-manager.service');

            const rawKey = await getDecryptedPrivateKey(task.walletId as string, task.userId);
            const hexKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`;
            const account = privateKeyToAccount(hexKey);
            const txForBump = await getClient(wallet.chain, task.userId).getTransaction({ hash });
            if (!txForBump) throw new Error('Cannot bump: original transaction not found');

            await bumpTransactionGas(account, {
              chain: wallet.chain,
              nonce: txForBump.nonce,
              contractAddress: task.contractAddress as `0x${string}`,
              data: txForBump.input,
              value: txForBump.value,
              currentMaxFeePerGas: txForBump.maxFeePerGas ?? undefined,
              currentMaxPriorityFeePerGas: txForBump.maxPriorityFeePerGas ?? undefined,
              currentGasPrice: txForBump.gasPrice ?? undefined,
              gasLimit: txForBump.gas,
              userId: task.userId,
            });
            addBreadcrumb({
              category: 'qstash',
              message: 'receipt recheck: gas bump attempted',
              level: 'info',
              data: { taskId, txHash: hash },
            });
          } catch (bumpError) {
            // Best-effort — never block the recheck on a failed bump
            addBreadcrumb({
              category: 'qstash',
              message: 'receipt recheck: gas bump failed (non-fatal)',
              level: 'warning',
              data: { taskId, error: String(bumpError) },
            });
          }
        })();
      }

      await publishQStashMessage(taskId, recheckAt, 'receipt_check');

      addBreadcrumb({
        category: 'qstash',
        message: 'receipt recheck: rescheduled',
        level: 'warning',
        data: { taskId, txHash: hash, recheckAttemptsRemaining: recheckAttemptsRemaining - 1 },
      });

      return {
        success: false,
        retrying: true,
        txHash: hash,
        recheckAttemptsRemaining: recheckAttemptsRemaining - 1,
      };
    }

    // Reliability fix (R-3): previously left the task as 'unconfirmed' forever
    // when the receipt recheck budget was exhausted. This meant the task was
    // silently stuck with no automatic resolution or user notification.
    //
    // Fix: mark as 'failed' and notify the user. The transaction has been
    // pending for 10+ receipt checks (5+ minutes with gas bumps). At this
    // point either:
    //   a) The tx was dropped from the mempool (R-4 should have caught this)
    //   b) The tx is stuck due to severe network congestion
    //   c) The RPC is failing to return the receipt (rare)
    //
    // The user must be notified so they can decide whether to re-mint.
    // The txHash is preserved in the failed task for manual investigation.
    await getDb()
      .update(mintTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(and(eq(mintTasks.id, taskId), eq(mintTasks.status, 'unconfirmed')));

    await captureMessage('Receipt recheck budget exhausted — task marked failed', {
      area: 'qstash',
      level: 'error',
      context: { taskId, transactionHash: hash },
      fingerprint: ['qstash', 'receipt-recheck-exhausted'],
    });

    await logActivity(task.userId, 'mint_status_changed', 'Receipt recheck exhausted — mint marked failed', {
      taskId, txHash: hash,
    });

    // Notify user via Telegram + email
    const { sendTelegramNotification } = await import('@/lib/services/telegram.service');
    await sendTelegramNotification(task.userId, 'mint_failed', {
      taskId,
      contractAddress: task.contractAddress || undefined,
      error: 'Transaction unconfirmed after maximum receipt checks. Check your wallet — the tx may still confirm.',
    }).catch(() => undefined);

    const { sendMintFailedEmail } = await import('@/lib/services/email-notification.service');
    await sendMintFailedEmail(task.userId, {
      taskId,
      contractAddress: task.contractAddress || undefined,
      error: 'Transaction unconfirmed after maximum receipt checks.',
    }).catch(() => undefined);

    return { success: false, txHash: hash, error: 'receipt_recheck_exhausted' };
  }
}
// ─── Reliability: Stuck Task Recovery ────────────────────────────────────────
//
// Periodically scan for mint tasks stuck in 'running' status beyond a threshold.
// Two failure modes are handled:
//   Pre-broadcast (no txHash): reset to 'ready' and re-execute
//   Post-broadcast (has txHash): transition to 'unconfirmed' and recheck receipt
//
// Trigger via:
//   1. scheduleRecoveryCheck() — schedules an immediate QStash recovery message
//   2. Vercel cron: POST /api/recovery/mint on a schedule (e.g. every 5 minutes)
//   3. Automatic trigger from nonce gap detection

/**
 * Schedule an immediate recovery check via QStash.
 * Fires a type='recovery' message that the webhook handler routes to executeRecoveryCheck().
 */
export async function scheduleRecoveryCheck(): Promise<void> {
  try {
    await publishQStashMessage('recovery', new Date(), 'recovery');
  } catch (error) {
    // Log but don't throw — recovery scheduling failure should not break the calling path
    addBreadcrumb({
      category: 'recovery',
      message: 'Failed to schedule recovery check via QStash',
      level: 'warning',
      data: { error: String(error) },
    });
  }
}

/**
 * Execute a full recovery scan.
 * Called by the QStash webhook when type='recovery'.
 * Also callable directly from an API route for Vercel cron integration.
 */
// Recovery loop cadence. Tightened from 5 min → 60s so a function killed
// mid-mint (Vercel 10s budget) is detected and re-fired within ~90-150s
// instead of 10-15 min. C1's onBroadcast txHash persist + H3's nonce-count
// guard make this safe — recovery never re-broadcasts a tx that is already
// on chain or in the mempool.
const RECOVERY_INTERVAL_MS = 60 * 1000; // 60 seconds

export async function executeRecoveryCheck() {
  const { recoverStuckMintTasks } = await import('@/lib/services/mint-recovery.service');
  const result = await recoverStuckMintTasks();

  addBreadcrumb({
    category: 'recovery',
    message: 'Recovery check completed',
    level: 'info',
    data: { ...result },
  });

  // Self-schedule the next recovery check via QStash in 5 minutes.
  // This keeps the recovery loop running entirely within QStash —
  // no Vercel cron or external scheduler needed.
  // If this schedule fails, the next nonce gap event will restart the loop.
  void publishQStashMessage('recovery', new Date(Date.now() + RECOVERY_INTERVAL_MS), 'recovery')
    .catch(() => undefined); // best-effort — non-fatal

  return result;
}
