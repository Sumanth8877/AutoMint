import 'server-only';

import { eq } from 'drizzle-orm';
import { integrationSettings } from '@/drizzle/schema';
import { getDb } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/security/encryption';

export const INTEGRATION_SETTING_KEYS = ['ALCHEMY_API_KEY', 'INFURA_API_KEY', 'CHAINSTACK_API_KEY'] as const;
export type IntegrationSettingKey = typeof INTEGRATION_SETTING_KEYS[number];

export type IntegrationSetting = {
  key: IntegrationSettingKey;
  value: string;
  createdAt: Date;
  updatedAt: Date;
};

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

  return decryptRow(row);
}

export async function getAllSettings() {
  const rows = await getDb().select().from(integrationSettings);
  const settings = {} as Partial<Record<IntegrationSettingKey, IntegrationSetting>>;

  for (const row of rows) {
    if (INTEGRATION_SETTING_KEYS.includes(row.key as IntegrationSettingKey)) {
      const setting = decryptRow(row);
      settings[setting.key] = setting;
    }
  }

  return settings;
}

export async function deleteSetting(key: IntegrationSettingKey) {
  assertSupportedKey(key);
  await getDb().delete(integrationSettings).where(eq(integrationSettings.key, key));
}
