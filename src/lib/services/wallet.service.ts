import { getDb } from '@/lib/db';
import { wallets, users } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { getWalletBalance } from '@/lib/blockchain/wallet';

export async function getUserWallets(userId: string) {
  const result = await getDb().select().from(wallets).where(eq(wallets.userId, userId)).orderBy(wallets.createdAt);
  return result;
}

export async function getWalletById(id: string, userId: string) {
  const result = await getDb().select().from(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId))).limit(1);
  return result[0] || null;
}

export async function addWallet(userId: string, data: { address: string; nickname?: string | null; chain: string }) {
  // ensure user exists
  const user = await getDb().select().from(users).where(eq(users.clerkId, userId)).limit(1);
  if (user.length === 0) throw new Error('User not found');

  const [wallet] = await getDb().insert(wallets).values({
    userId: user[0].id,
    address: data.address.toLowerCase(),
    nickname: data.nickname || null,
    chain: data.chain as 'ethereum' | 'base' | 'polygon',
  }).returning();

  return wallet;
}

export async function deleteWallet(id: string, userId: string) {
  const existing = await getWalletById(id, userId);
  if (!existing) throw new Error('Wallet not found');

  await getDb().delete(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId)));
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