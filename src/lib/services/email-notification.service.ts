import 'server-only';

import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collections, emailNotificationPreferences, mintTasks, users, wallets } from '@/drizzle/schema';
import { renderEmailTemplate } from '@/lib/email-templates';

type PreferenceUpdate = Partial<Pick<
  typeof emailNotificationPreferences.$inferInsert,
  'emailEnabled' | 'mintScheduledEnabled' | 'mintSuccessEnabled' | 'mintFailedEnabled' | 'systemErrorsEnabled'
>>;

type EmailType = 'mintScheduled' | 'mintSuccess' | 'mintFailed' | 'systemErrors';

type MintEmailPayload = {
  taskId?: string;
  contractAddress?: string;
  txHash?: string;
  error?: string;
  status?: string;
};

type SystemErrorPayload = {
  taskId?: string;
  title?: string;
  error?: string;
};

type TaskEmailDetails = {
  taskName: string;
  collectionName: string;
  chain: string;
  timestamp: string;
  status: string;
  contractAddress?: string;
  txHash?: string;
  reason?: string;
};

const RESEND_API_URL = 'https://api.resend.com/emails';
const EMAIL_FROM = 'AutoMint <onboarding@resend.dev>';

function getResendApiKey() {
  return process.env.RESEND_API_KEY;
}

// Explicit allowlist of env var names that hold secrets.
// Using a Set instead of a regex eliminates the risk of a new var being
// missed because it doesn't match the pattern, and avoids accidental matches
// on public/non-secret vars (e.g. NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).
// When you add a new secret env var, add it here too.
const SENSITIVE_ENV_KEYS = new Set([
  // Database
  'DATABASE_URL',
  // Clerk auth
  'CLERK_SECRET_KEY',
  // Encryption
  'ENCRYPTION_KEY',
  'ENCRYPTION_KEY_PREVIOUS',
  // Upstash / Redis
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_TOKEN',
  // QStash
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  // Email
  'RESEND_API_KEY',

  // RPC providers (stored in DB but may also be present as env fallbacks)
  'ALCHEMY_API_KEY',
  'INFURA_API_KEY',
  'CHAINSTACK_API_KEY',
  'OPENSEA_API_KEY',
  // Telegram
  'TELEGRAM_BOT_TOKEN',
]);

function sensitiveEnvValues() {
  return Array.from(SENSITIVE_ENV_KEYS)
    .map((key) => process.env[key])
    .filter((value): value is string => typeof value === 'string' && value.length >= 4);
}

export function sanitizeNotificationError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error ?? 'Unknown error');

  for (const secret of sensitiveEnvValues()) {
    message = message.split(secret).join('[redacted]');
  }

  return message
    .replace(/\b0x[a-fA-F0-9]{64}\b/g, '[redacted]')
    .slice(0, 500);
}

async function getUserForEmail(userId: string) {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1);
  return user ?? null;
}

export async function getEmailNotificationPreferences(userId: string) {
  const [existing] = await getDb()
    .select()
    .from(emailNotificationPreferences)
    .where(eq(emailNotificationPreferences.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await getDb()
    .insert(emailNotificationPreferences)
    .values({ userId })
    .returning();

  return created;
}

export async function updateEmailNotificationPreferences(userId: string, values: PreferenceUpdate) {
  await getEmailNotificationPreferences(userId);

  const [updated] = await getDb()
    .update(emailNotificationPreferences)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(emailNotificationPreferences.userId, userId))
    .returning();

  return updated;
}

async function preferencesAllow(userId: string, type: EmailType) {
  const [preference, user] = await Promise.all([
    getEmailNotificationPreferences(userId),
    getUserForEmail(userId),
  ]);

  if (!user?.email || !preference.emailEnabled) return null;

  const enabledByType = {
    mintScheduled: preference.mintScheduledEnabled,
    mintSuccess: preference.mintSuccessEnabled,
    mintFailed: preference.mintFailedEnabled,
    systemErrors: preference.systemErrorsEnabled,
  };

  return enabledByType[type] ? { user } : null;
}

async function getTaskEmailDetails(userId: string, payload: MintEmailPayload): Promise<TaskEmailDetails> {
  if (!payload.taskId) {
    return {
      taskName: 'Mint Task',
      collectionName: 'Unknown collection',
      chain: 'Unknown chain',
      timestamp: new Date().toISOString(),
      status: payload.status ?? 'Unknown',
      contractAddress: payload.contractAddress,
      txHash: payload.txHash,
      reason: payload.error ? sanitizeNotificationError(payload.error) : undefined,
    };
  }

  const [row] = await getDb()
    .select({ task: mintTasks, collection: collections, wallet: wallets })
    .from(mintTasks)
    .leftJoin(collections, eq(mintTasks.collectionId, collections.id))
    .leftJoin(wallets, eq(mintTasks.walletId, wallets.id))
    .where(and(eq(mintTasks.id, payload.taskId), eq(mintTasks.userId, userId)))
    .limit(1);

  return {
    taskName: `Mint Task ${payload.taskId.slice(0, 8)}`,
    collectionName: row?.collection?.name || row?.task.contractAddress || payload.contractAddress || 'Unknown collection',
    chain: row?.collection?.chain || row?.wallet?.chain || 'Unknown chain',
    timestamp: new Date().toISOString(),
    status: payload.status ?? row?.task.status ?? 'Unknown',
    contractAddress: payload.contractAddress ?? row?.task.contractAddress ?? undefined,
    txHash: payload.txHash ?? row?.task.txHash ?? undefined,
    reason: payload.error ? sanitizeNotificationError(payload.error) : undefined,
  };
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = getResendApiKey();
  if (!apiKey) return false;

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Resend request failed with status ${response.status}`);
  }

  return true;
}

async function sendNotificationEmail(userId: string, type: EmailType, heading: string, preview: string, payload: MintEmailPayload) {
  try {
    const allowed = await preferencesAllow(userId, type);
    if (!allowed) return false;

    const details = await getTaskEmailDetails(userId, payload);
    const html = renderEmailTemplate(type, heading, preview, details);

    return await sendEmail(allowed.user.email, `AutoMint: ${heading}`, html);
  } catch (_error) {
    return false;
  }
}

export async function sendMintScheduledEmail(userId: string, payload: MintEmailPayload = {}) {
  return sendNotificationEmail(
    userId,
    'mintScheduled',
    'Mint Scheduled',
    'Your mint task has been successfully scheduled.',
    { ...payload, status: 'Scheduled' },
  );
}

export async function sendMintSuccessEmail(userId: string, payload: MintEmailPayload = {}) {
  return sendNotificationEmail(
    userId,
    'mintSuccess',
    'Mint Success',
    'Mint completed successfully.',
    { ...payload, status: 'Completed' },
  );
}

export async function sendMintFailedEmail(userId: string, payload: MintEmailPayload = {}) {
  return sendNotificationEmail(
    userId,
    'mintFailed',
    'Mint Failed',
    'Mint failed.',
    { ...payload, status: 'Failed' },
  );
}

export async function sendSystemErrorEmail(userId: string, payload: SystemErrorPayload = {}) {
  return sendNotificationEmail(
    userId,
    'systemErrors',
    payload.title ?? 'System Error',
    'A user-relevant AutoMint system error affected a task.',
    { taskId: payload.taskId, error: payload.error, status: 'System Error' },
  );
}

export function isResendConfigured() {
  return Boolean(getResendApiKey());
}
