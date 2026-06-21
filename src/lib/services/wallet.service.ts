import { getDb } from '@/lib/db';
import { executionSettings, mintTasks, wallets, walletPermissions } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getWalletBalance } from '@/lib/blockchain/wallet';
import { encryptPrivateKey, decryptPrivateKey } from '@/lib/security/encryption';
import { logActivity } from '@/lib/monitoring';
import { assertValidWalletAddress, isWalletType, type WalletType } from '@/lib/wallets/detection';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export async function getUserWallets(userId: string) {
  const result = await getDb()
    .select({
      id: wallets.id,
      userId: wallets.userId,
      address: wallets.address,
      nickname: wallets.nickname,
      chain: wallets.chain,
      walletType: wallets.walletType,
      isDefault: wallets.isDefault,
      encryptedPrivateKey: wallets.encryptedPrivateKey,
      encryptionVersion: wallets.encryptionVersion,
      createdAt: wallets.createdAt,
      updatedAt: wallets.updatedAt,
      pendingScheduledTasks: sql<number>`count(${mintTasks.id}) filter (
        where ${mintTasks.walletId} = ${wallets.id}
          and (${mintTasks.scheduledTime} is not null or ${mintTasks.qstashMessageId} is not null)
          and ${mintTasks.status} in ('pending', 'monitoring', 'ready', 'running')
      )::int`,
    })
    .from(wallets)
    .leftJoin(mintTasks, and(eq(mintTasks.walletId, wallets.id), eq(mintTasks.userId, userId)))
    .where(eq(wallets.userId, userId))
    .groupBy(wallets.id)
    .orderBy(wallets.createdAt);
  return result;
}

export async function getWalletById(id: string, userId: string) {
  const result = await getDb().select().from(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId))).limit(1);
  return result[0] || null;
}

export async function createWallet(userId: string, data: { address: string; nickname?: string | null; chain: string; walletTypeOverride?: string | null }) {
  const override = isWalletType(data.walletTypeOverride) ? data.walletTypeOverride as WalletType : undefined;
  const detected = assertValidWalletAddress(data.address, override);

  if (detected.walletType === 'EVM' && !SUPPORTED_CHAINS.includes(data.chain as SupportedChain)) {
    throw new Error(`Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
  }

  const chain = detected.walletType === 'EVM' ? data.chain as SupportedChain : 'ethereum';

  const [existing] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.address, detected.address)))
    .limit(1);

  if (existing) {
    throw new Error('Wallet already added');
  }

  const [existingUserWallet] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);

  const [wallet] = await getDb().insert(wallets).values({
    userId,
    address: detected.address,
    nickname: data.nickname || null,
    chain,
    walletType: detected.walletType,
    isDefault: !existingUserWallet,
  }).returning();

  if (wallet.isDefault && wallet.walletType === 'EVM') {
    await getDb()
      .insert(executionSettings)
      .values({ userId, defaultWalletId: wallet.id })
      .onConflictDoUpdate({
        target: executionSettings.userId,
        set: { defaultWalletId: wallet.id, updatedAt: new Date() },
      });
  }

  await getDb().insert(walletPermissions).values({
    userId,
    walletId: wallet.id,
    canMint: false,
    canMonitor: true,
  });

  await logActivity(userId, 'wallet_added', 'Wallet created', {
    walletId: wallet.id,
    address: wallet.address,
    chain: wallet.chain,
    walletType: wallet.walletType,
  });

  return wallet;
}

export async function importWallet(userId: string, data: { address: string; privateKey: string; nickname?: string | null; chain: string }) {
  const detected = assertValidWalletAddress(data.address);
  if (detected.walletType !== 'EVM') {
    throw new Error('Private key import is only supported for EVM wallets');
  }

  if (!SUPPORTED_CHAINS.includes(data.chain as SupportedChain)) {
    throw new Error(`Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
  }

  const encrypted = encryptPrivateKey(data.privateKey);

  const [existing] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.address, detected.address)))
    .limit(1);

  if (existing) {
    throw new Error('Wallet already added');
  }

  const [wallet] = await getDb().insert(wallets).values({
    userId,
    address: detected.address,
    nickname: data.nickname || null,
    chain: data.chain as SupportedChain,
    walletType: detected.walletType,
    encryptedPrivateKey: JSON.stringify(encrypted),
    encryptionVersion: 1,
  }).returning();

  await getDb().insert(walletPermissions).values({
    userId,
    walletId: wallet.id,
    canMint: false,
    canMonitor: true,
  });

  await logActivity(userId, 'wallet_imported', 'Wallet imported', {
    walletId: wallet.id,
    address: wallet.address,
    chain: wallet.chain,
    walletType: wallet.walletType,
  });

  return wallet;
}

export async function getDecryptedPrivateKey(walletId: string, userId: string): Promise<string> {
  const [wallet] = await getDb()
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)))
    .limit(1);

  if (!wallet) throw new Error('Wallet not found');
  if (!wallet.encryptedPrivateKey) throw new Error('Wallet does not have an imported private key');

  const payload = JSON.parse(wallet.encryptedPrivateKey) as Parameters<typeof decryptPrivateKey>[0];
  return decryptPrivateKey(payload);
}

export async function removeWallet(id: string, userId: string) {
  const existing = await getWalletById(id, userId);
  if (!existing) throw new Error('Wallet not found');

  await getDb().delete(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId)));

  await logActivity(userId, 'wallet_removed', 'Wallet removed', {
    walletId: id,
    address: existing.address,
    chain: existing.chain,
  });

  return { success: true };
}

export async function updateWallet(id: string, userId: string, data: { nickname?: string | null; chain?: string }) {
  const existing = await getWalletById(id, userId);
  if (!existing) throw new Error('Wallet not found');

  if (data.chain && !SUPPORTED_CHAINS.includes(data.chain as SupportedChain)) {
    throw new Error(`Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
  }

  const [updated] = await getDb()
    .update(wallets)
    .set({
      nickname: data.nickname ?? null,
      chain: (data.chain ?? existing.chain) as SupportedChain,
      updatedAt: new Date(),
    })
    .where(and(eq(wallets.id, id), eq(wallets.userId, userId)))
    .returning();

  return updated;
}

export async function setDefaultWallet(id: string, userId: string) {
  const existing = await getWalletById(id, userId);
  if (!existing) throw new Error('Wallet not found');
  if (existing.walletType !== 'EVM') throw new Error('Default wallet must be an EVM wallet');

  await getDb()
    .update(wallets)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(wallets.userId, userId));

  const [updated] = await getDb()
    .update(wallets)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(wallets.id, id), eq(wallets.userId, userId)))
    .returning();

  await getDb()
    .insert(executionSettings)
    .values({ userId, defaultWalletId: updated.id })
    .onConflictDoUpdate({
      target: executionSettings.userId,
      set: { defaultWalletId: updated.id, updatedAt: new Date() },
    });

  return updated;
}

export async function fetchBalance(address: string, chain: string) {
  try {
    const bal = await getWalletBalance(address, chain);
    return { success: true, balance: bal };
  } catch (error) {
    console.error('Balance fetch failed:', error);
    return { success: false, balance: null, error: 'Failed to fetch balance' };
  }
}
