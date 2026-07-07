import 'server-only';

import { eq } from 'drizzle-orm';
import { integrationSettings } from '@/drizzle/schema';
import { getDb } from '@/lib/db';
import { decrypt, encrypt, rotateEncryption } from '@/lib/security/encryption';
import { getCache, setCache, getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const INTEGRATION_SETTING_KEYS = ['ALCHEMY_API_KEY', 'INFURA_API_KEY', 'CHAINSTACK_API_KEY', 'GEMINI_API_KEY', 'NARA_API_KEY', 'OPENROUTER_API_KEY', 'SOCIALDATA_API_KEY'] as const;
export type IntegrationSettingKey = typeof INTEGRATION_SETTING_KEYS[number];

export type IntegrationSetting = {
  key: IntegrationSettingKey;
  value: string;
  createdAt: Date;
  updatedAt: Date;
};

// ── Settings cache ─────────────────────────────────────────────────────────────
// getAllSettings() is called on every RPC URL build (getAlchemyUrl, getInfuraUrl,
// getChainstackUrl). In a single mint execution: simulate + nonce + gasParams each
// call getAllSettings() — that's 3+ DB reads per mint without caching.
// 60s TTL: short enough that a key rotation takes effect within one minute.
const SETTINGS_CACHE_KEY = 'integration:settings:all';
const SETTINGS_CACHE_TTL  = 60; // seconds

async function invalidateSettingsCache() {
  try { await getRedisClient().del(SETTINGS_CACHE_KEY); } catch { /* non-fatal */ }
}

function assertSupportedKey(key: string): asserts key is IntegrationSettingKey {
  if (!INTEGRATION_SETTING_KEYS.includes(key as IntegrationSettingKey)) {
    throw new Error(`Unsupported integration setting: ${key}`);
  }
}

function decryptRow(row: typeof integrationSettings.$inferSelect): IntegrationSetting {
  assertSupportedKey(row.key);
  return {
    key: row.key,
    value: decrypt(row.valueEncrypted),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getSetting(key: IntegrationSettingKey) {
  assertSupportedKey(key);

  const [row] = await getDb()
    .select()
    .from(integrationSettings)
    .where(eq(integrationSettings.key, key))
    .limit(1);

  return row ? decryptRow(row) : null;
}

export async function setSetting(key: IntegrationSettingKey, value: string) {
  assertSupportedKey(key);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${key} cannot be empty`);

  const [row] = await getDb()
    .insert(integrationSettings)
    .values({
      key,
      valueEncrypted: encrypt(normalized),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: integrationSettings.key,
      set: {
        valueEncrypted: encrypt(normalized),
        updatedAt: new Date(),
      },
    })
    .returning();

  void invalidateSettingsCache();
  return decryptRow(row);
}

export async function getAllSettings() {
  const cached = await getCache<Partial<Record<IntegrationSettingKey, IntegrationSetting>>>(SETTINGS_CACHE_KEY);
  if (cached) return cached;

  const rows = await getDb().select().from(integrationSettings);
  const settings = {} as Partial<Record<IntegrationSettingKey, IntegrationSetting>>;

  for (const row of rows) {
    if (INTEGRATION_SETTING_KEYS.includes(row.key as IntegrationSettingKey)) {
      const setting = decryptRow(row);
      settings[setting.key] = setting;
    }
  }

  void setCache(SETTINGS_CACHE_KEY, settings, SETTINGS_CACHE_TTL).catch(() => undefined);
  return settings;
}

export async function deleteSetting(key: IntegrationSettingKey) {
  assertSupportedKey(key);
  await getDb().delete(integrationSettings).where(eq(integrationSettings.key, key));
  void invalidateSettingsCache();
}

// ── Key rotation ───────────────────────────────────────────────────────────────
//
// Call after setting ENCRYPTION_KEY to the new value and ENCRYPTION_KEY_PREVIOUS
// to the old value. Re-encrypts all stored integration secrets with the active key.
//
// Step-by-step:
//   1. openssl rand -hex 32  →  paste as ENCRYPTION_KEY in Vercel
//   2. Move old key to ENCRYPTION_KEY_PREVIOUS
//   3. Call rotateAllIntegrationSettings() (from a one-off script or admin route)
//   4. Remove ENCRYPTION_KEY_PREVIOUS once confirmed
//
export async function rotateAllIntegrationSettings(): Promise<{ rotated: number; skipped: number }> {
  const rows = await getDb().select().from(integrationSettings);
  let rotated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const newCiphertext = rotateEncryption(row.valueEncrypted);
      // Only update if the ciphertext actually changed (i.e. was encrypted with an old key)
      if (newCiphertext !== row.valueEncrypted) {
        await getDb()
          .update(integrationSettings)
          .set({ valueEncrypted: newCiphertext, updatedAt: new Date() })
          .where(eq(integrationSettings.key, row.key));
        rotated++;
      } else {
        skipped++;
      }
    } catch (err) {
      // Non-fatal: log and continue so one bad row doesn't abort the migration
      logger.error(`[rotateAllIntegrationSettings] Failed to rotate key ${row.key}:`, { error: err instanceof Error ? err.message : String(err) });
      skipped++;
    }
  }

  void invalidateSettingsCache();
  return { rotated, skipped };
}
