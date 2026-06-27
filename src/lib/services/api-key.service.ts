import 'server-only';

import { randomBytes, createHash } from 'node:crypto';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { apiKeys } from '@/drizzle/schema';
import { logger } from '@/lib/logger';

// ─── Constants ──────────────────────────────────────────────
const KEY_PREFIX = 'am';             // AutoMint key prefix
const KEY_BYTES = 32;                // 256-bit entropy
const PREFIX_LENGTH = 8;             // Visible prefix for identification (am_xxxxxxxx...)
const MAX_KEYS_PER_USER = 10;        // Hard limit

// ─── Types ──────────────────────────────────────────────────
export type ApiKeyScope = '*' | 'mints:read' | 'mints:write' | 'history:read' | 'analyzer:read' | 'wallets:read' | 'collections:read';

export interface CreateApiKeyInput {
  name: string;
  scopes?: ApiKeyScope[];
  expiresInDays?: number | null;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateApiKeyResult {
  /** The full API key — shown ONCE to the user, never stored */
  plainTextKey: string;
  /** The persisted key record (no secret) */
  key: ApiKeyRecord;
}

export interface AuthenticatedApiKey {
  userId: string;
  keyId: string;
  scopes: string[];
}

// ─── Helpers ────────────────────────────────────────────────

/** Generate a cryptographically random API key: am_<base64url> */
function generateApiKey(): { plainText: string; prefix: string; hash: string } {
  const raw = randomBytes(KEY_BYTES);
  const secret = raw.toString('base64url');
  const plainText = `${KEY_PREFIX}_${secret}`;
  const prefix = `${KEY_PREFIX}_${secret.slice(0, PREFIX_LENGTH)}`;
  const hash = hashKey(plainText);
  return { plainText, prefix, hash };
}

/** SHA-256 hash of the full key — this is what we store & compare */
function hashKey(plainText: string): string {
  return createHash('sha256').update(plainText).digest('hex');
}

// ─── CRUD ───────────────────────────────────────────────────

/**
 * Create a new API key for the given user.
 * Returns the plain-text key exactly once.
 */
export async function createApiKey(
  userId: string,
  input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
  const db = getDb();

  // Enforce per-user limit
  const existing = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));

  if (existing.length >= MAX_KEYS_PER_USER) {
    throw new Error(`Maximum of ${MAX_KEYS_PER_USER} active API keys allowed per user`);
  }

  const { plainText, prefix, hash } = generateApiKey();

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000)
    : null;

  const [row] = await db
    .insert(apiKeys)
    .values({
      userId,
      name: input.name.trim(),
      prefix,
      hash,
      scopes: input.scopes ?? ['*'],
      expiresAt,
    })
    .returning();

  logger.info('API key created', { area: 'api-keys', userId, keyId: row.id, prefix });

  return {
    plainTextKey: plainText,
    key: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes as string[],
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

/** List all API keys for a user (newest first). Never exposes hashes. */
export async function listApiKeys(userId: string): Promise<ApiKeyRecord[]> {
  const rows = await getDb()
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
      updatedAt: apiKeys.updatedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));

  return rows.map((r) => ({
    ...r,
    scopes: r.scopes as string[],
  }));
}

/** Revoke a key (soft-delete — keeps the record for audit). */
export async function revokeApiKey(keyId: string, userId: string): Promise<void> {
  const [updated] = await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });

  if (!updated) {
    throw new Error('API key not found or already revoked');
  }

  logger.info('API key revoked', { area: 'api-keys', userId, keyId });
}

/** Permanently delete a key record. */
export async function deleteApiKey(keyId: string, userId: string): Promise<void> {
  const [deleted] = await getDb()
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });

  if (!deleted) {
    throw new Error('API key not found');
  }

  logger.info('API key deleted', { area: 'api-keys', userId, keyId });
}

/** Rename an API key. */
export async function renameApiKey(keyId: string, userId: string, name: string): Promise<void> {
  const [updated] = await getDb()
    .update(apiKeys)
    .set({ name: name.trim(), updatedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });

  if (!updated) {
    throw new Error('API key not found');
  }
}

// ─── Authentication ─────────────────────────────────────────

/**
 * Authenticate a Bearer token against stored API keys.
 *
 * Returns the owning userId + keyId if valid, or null if the key
 * is unknown, revoked, or expired.
 *
 * Side-effect: updates lastUsedAt (fire-and-forget, never blocks auth).
 */
export async function authenticateApiKey(bearerToken: string): Promise<AuthenticatedApiKey | null> {
  const hash = hashKey(bearerToken);

  const [row] = await getDb()
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      scopes: apiKeys.scopes,
      revokedAt: apiKeys.revokedAt,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.hash, hash))
    .limit(1);

  if (!row) return null;

  // Revoked?
  if (row.revokedAt) return null;

  // Expired?
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

  // Update last-used timestamp (fire-and-forget)
  void getDb()
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});

  return {
    userId: row.userId,
    keyId: row.id,
    scopes: row.scopes as string[],
  };
}
