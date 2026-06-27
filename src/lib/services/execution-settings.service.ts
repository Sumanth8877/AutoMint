import 'server-only';

import { and, eq } from 'drizzle-orm';
import { executionSettings, wallets } from '@/drizzle/schema';
import { getDb } from '@/lib/db';
import { cacheWithTTL, invalidateCache } from '@/lib/redis';

export const GAS_STRATEGIES = ['STANDARD', 'FAST', 'AGGRESSIVE'] as const;

export type GasStrategy = (typeof GAS_STRATEGIES)[number];

export type ExecutionSettingsUpdate = {
  defaultMintQuantity?: number;
  defaultWalletId?: string | null;
  gasStrategy?: GasStrategy;
  maxRetries?: number;
  riskThreshold?: number;
  autoRunAnalyzer?: boolean;
  autoDetectSocials?: boolean;
  autoDetectContractInfo?: boolean;
  autoDetectMintDetails?: boolean;
  riskAnalysisEnabled?: boolean;
};

function clampInteger(value: number, min: number, max: number, field: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

function assertBoolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') throw new Error(`${field} must be true or false`);
  return value;
}

function assertGasStrategy(value: unknown) {
  if (!GAS_STRATEGIES.includes(value as GasStrategy)) {
    throw new Error('Gas strategy must be STANDARD, FAST, or AGGRESSIVE');
  }
  return value as GasStrategy;
}

async function getOwnedEvmWallet(userId: string, walletId: string) {
  const [wallet] = await getDb()
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId), eq(wallets.walletType, 'EVM')))
    .limit(1);

  return wallet ?? null;
}

async function getCurrentDefaultWalletId(userId: string) {
  const [wallet] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.walletType, 'EVM'), eq(wallets.isDefault, true)))
    .limit(1);

  return wallet?.id ?? null;
}

export async function getExecutionSettings(userId: string) {
  const [existing] = await getDb()
    .select()
    .from(executionSettings)
    .where(eq(executionSettings.userId, userId))
    .limit(1);

  if (existing) return existing;

  const [created] = await getDb()
    .insert(executionSettings)
    .values({
      userId,
      defaultWalletId: await getCurrentDefaultWalletId(userId),
    })
    .returning();

  return created;
}

export async function getExecutionSettingsPayload(userId: string) {
  const [settings, userWallets] = await Promise.all([
    getExecutionSettings(userId),
    getDb()
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.walletType, 'EVM')))
      .orderBy(wallets.createdAt),
  ]);

  return {
    settings,
    wallets: userWallets,
    currentDefaultWalletId: userWallets.find((wallet) => wallet.isDefault)?.id ?? null,
  };
}

export async function updateExecutionSettings(userId: string, input: Record<string, unknown>) {
  await getExecutionSettings(userId);

  const update: ExecutionSettingsUpdate = {};

  if ('defaultMintQuantity' in input) update.defaultMintQuantity = clampInteger(Number(input.defaultMintQuantity), 1, 100, 'Default mint quantity');
  if ('gasStrategy' in input) update.gasStrategy = assertGasStrategy(input.gasStrategy);
  if ('maxRetries' in input) update.maxRetries = clampInteger(Number(input.maxRetries), 0, 100, 'Maximum retry attempts');
  if ('riskThreshold' in input) update.riskThreshold = clampInteger(Number(input.riskThreshold), 0, 100, 'Risk threshold');
  if ('autoRunAnalyzer' in input) update.autoRunAnalyzer = assertBoolean(input.autoRunAnalyzer, 'autoRunAnalyzer');
  if ('autoDetectSocials' in input) update.autoDetectSocials = assertBoolean(input.autoDetectSocials, 'autoDetectSocials');
  if ('autoDetectContractInfo' in input) update.autoDetectContractInfo = assertBoolean(input.autoDetectContractInfo, 'autoDetectContractInfo');
  if ('autoDetectMintDetails' in input) update.autoDetectMintDetails = assertBoolean(input.autoDetectMintDetails, 'autoDetectMintDetails');
  if ('riskAnalysisEnabled' in input) update.riskAnalysisEnabled = assertBoolean(input.riskAnalysisEnabled, 'riskAnalysisEnabled');
  if ('defaultWalletId' in input) {
    const walletId = typeof input.defaultWalletId === 'string' && input.defaultWalletId ? input.defaultWalletId : null;
    if (walletId) {
      const wallet = await getOwnedEvmWallet(userId, walletId);
      if (!wallet) throw new Error('Default wallet not found');
    }
    update.defaultWalletId = walletId;
  }

  const [updated] = await getDb()
    .update(executionSettings)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(executionSettings.userId, userId))
    .returning();

  // Invalidate cached defaults so the next request fetches fresh settings.
  await invalidateCache(execDefaultsCacheKey(userId));

  return updated;
}

// Cache TTL for execution defaults: 60 seconds.
// Settings change rarely (only when user saves the settings page).
// The cache is invalidated immediately on updateExecutionSettings().
const EXEC_DEFAULTS_TTL = 60;

const execDefaultsCacheKey = (userId: string) => `exec-defaults:${userId}`;

export async function getEffectiveExecutionDefaults(userId: string) {
  return cacheWithTTL(
    execDefaultsCacheKey(userId),
    async () => {
      const settings = await getExecutionSettings(userId);
      const defaultWalletId = settings.defaultWalletId ?? await getCurrentDefaultWalletId(userId);

      return {
        defaultMintQuantity: settings.defaultMintQuantity,
        defaultWalletId,
        gasStrategy: settings.gasStrategy,
        maxRetries: settings.maxRetries,
        riskThreshold: settings.riskThreshold,
        autoRunAnalyzer: settings.autoRunAnalyzer,
        autoDetectSocials: settings.autoDetectSocials,
        autoDetectContractInfo: settings.autoDetectContractInfo,
        autoDetectMintDetails: settings.autoDetectMintDetails,
        riskAnalysisEnabled: settings.riskAnalysisEnabled,
      };
    },
    EXEC_DEFAULTS_TTL,
  );
}
