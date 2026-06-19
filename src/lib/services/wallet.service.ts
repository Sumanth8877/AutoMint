import { getDb } from '@/lib/db';
import { wallets, walletPermissions } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { getWalletBalance } from '@/lib/blockchain/wallet';
import { encryptPrivateKey, decryptPrivateKey } from '@/lib/security/encryption';
import { logActivity } from '@/lib/monitoring';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export async function getUserWallets(userId: string) {
  const result = await getDb().select().from(wallets).where(eq(wallets.userId, userId)).orderBy(wallets.createdAt);
  return result;
}

export async function getWalletById(id: string, userId: string) {
  const result = await getDb().select().from(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId))).limit(1);
  return result[0] || null;
}

function isValidAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export async function createWallet(userId: string, data: { address: string; nickname?: string | null; chain: string }) {
  const address = data.address.toLowerCase();
  if (!isValidAddress(address)) {
    throw new Error('Invalid wallet address format');
  }

  if (!SUPPORTED_CHAINS.includes(data.chain as SupportedChain)) {
    throw new Error(`Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
  }

  const [existing] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.address, address), eq(wallets.chain, data.chain as SupportedChain)))
    .limit(1);

  if (existing) {
    throw new Error('Wallet already added');
  }

  const [wallet] = await getDb().insert(wallets).values({
    userId,
    address,
    nickname: data.nickname || null,
    chain: data.chain as SupportedChain,
  }).returning();

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
  });

  return wallet;
}

export async function importWallet(userId: string, data: { address: string; privateKey: string; nickname?: string | null; chain: string }) {
  const address = data.address.toLowerCase();
  if (!isValidAddress(address)) {
    throw new Error('Invalid wallet address format');
  }

  const encrypted = encryptPrivateKey(data.privateKey);

  const [wallet] = await getDb().insert(wallets).values({
    userId,
    address,
    nickname: data.nickname || null,
    chain: data.chain as 'ethereum' | 'base' | 'polygon',
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

export async function fetchBalance(address: string, chain: string) {
  try {
    const bal = await getWalletBalance(address, chain);
    return { success: true, balance: bal };
  } catch (error) {
    console.error('Balance fetch failed:', error);
    return { success: false, balance: null, error: 'Failed to fetch balance' };
  }
}
