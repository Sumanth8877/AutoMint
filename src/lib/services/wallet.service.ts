import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { executionSettings, mintTasks, wallets, walletPermissions } from '@/drizzle/schema';
import { getWalletBalance } from '@/lib/blockchain/wallet';
import { encryptPrivateKey, decryptPrivateKey } from '@/lib/security/encryption';
import { getCache, setCache } from '@/lib/redis';
import { logActivity } from '@/lib/monitoring';
import { deriveWalletFromPrivateKey, type ImportWalletType } from '@/lib/wallets/private-key';
import { addBreadcrumb } from '@/lib/observability/sentry';

const DEFAULT_EVM_CHAIN = 'ethereum' as const;

type WalletRow = typeof wallets.$inferSelect;
type PublicWalletRow = Omit<WalletRow, 'encryptedPrivateKey' | 'encryptionVersion'> & {
  pendingScheduledTasks?: number;
};

export type PublicWallet = {
  id: string;
  userId: string;
  address: string;
  nickname: string | null;
  chain: WalletRow['chain'];
  walletType: WalletRow['walletType'];
  isDefault: boolean;
  balance: string | null;
  balanceSymbol: string | null;
  balanceUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  pendingScheduledTasks: number;
};

type BalanceSnapshot = {
  balance: string;
  symbol: string;
  updatedAt: Date;
};

function toPublicWallet(row: PublicWalletRow): PublicWallet {
  return {
    id: row.id,
    userId: row.userId,
    address: row.address,
    nickname: row.nickname,
    chain: row.chain,
    walletType: row.walletType,
    isDefault: row.isDefault,
    balance: row.balance,
    balanceSymbol: row.balanceSymbol,
    balanceUpdatedAt: row.balanceUpdatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pendingScheduledTasks: row.pendingScheduledTasks ?? 0,
  };
}

function publicWalletSelect() {
  return {
    id: wallets.id,
    userId: wallets.userId,
    address: wallets.address,
    nickname: wallets.nickname,
    chain: wallets.chain,
    walletType: wallets.walletType,
    isDefault: wallets.isDefault,
    balance: wallets.balance,
    balanceSymbol: wallets.balanceSymbol,
    balanceUpdatedAt: wallets.balanceUpdatedAt,
    createdAt: wallets.createdAt,
    updatedAt: wallets.updatedAt,
    pendingScheduledTasks: sql<number>`count(${mintTasks.id}) filter (
      where ${mintTasks.walletId} = ${wallets.id}
        and (${mintTasks.scheduledTime} is not null or ${mintTasks.qstashMessageId} is not null)
        and ${mintTasks.status} in ('pending', 'monitoring', 'ready', 'running')
    )::int`,
  };
}

export async function getUserWallets(userId: string): Promise<PublicWallet[]> {
  const result = await getDb()
    .select(publicWalletSelect())
    .from(wallets)
    .leftJoin(mintTasks, and(eq(mintTasks.walletId, wallets.id), eq(mintTasks.userId, userId)))
    .where(eq(wallets.userId, userId))
    .groupBy(wallets.id)
    .orderBy(wallets.createdAt);

  return result.map(toPublicWallet);
}

export async function getWalletById(id: string, userId: string) {
  const result = await getDb()
    .select()
    .from(wallets)
    .where(and(eq(wallets.id, id), eq(wallets.userId, userId)))
    .limit(1);

  return result[0] || null;
}

async function getPublicWalletById(id: string, userId: string) {
  const [wallet] = await getUserWallets(userId);
  if (wallet?.id === id) return wallet;

  const result = await getDb()
    .select(publicWalletSelect())
    .from(wallets)
    .leftJoin(mintTasks, and(eq(mintTasks.walletId, wallets.id), eq(mintTasks.userId, userId)))
    .where(and(eq(wallets.id, id), eq(wallets.userId, userId)))
    .groupBy(wallets.id)
    .limit(1);

  return result[0] ? toPublicWallet(result[0]) : null;
}

async function fetchSolanaBalance(address: string): Promise<BalanceSnapshot> {
  const response = await fetch('https://api.mainnet-beta.solana.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'automint-wallet-balance',
      method: 'getBalance',
      params: [address],
    }),
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Failed to refresh balance');
  const payload = await response.json() as { result?: { value?: number } };
  const lamports = payload.result?.value;
  if (typeof lamports !== 'number') throw new Error('Failed to refresh balance');

  return {
    balance: (lamports / 1_000_000_000).toString(),
    symbol: 'SOL',
    updatedAt: new Date(),
  };
}

async function fetchBitcoinBalance(address: string): Promise<BalanceSnapshot> {
  const response = await fetch(`https://mempool.space/api/address/${encodeURIComponent(address)}`, {
    cache: 'no-store',
  });

  if (!response.ok) throw new Error('Failed to refresh balance');
  const payload = await response.json() as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
    mempool_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const confirmed = (payload.chain_stats?.funded_txo_sum ?? 0) - (payload.chain_stats?.spent_txo_sum ?? 0);
  const pending = (payload.mempool_stats?.funded_txo_sum ?? 0) - (payload.mempool_stats?.spent_txo_sum ?? 0);

  return {
    balance: ((confirmed + pending) / 100_000_000).toString(),
    symbol: 'BTC',
    updatedAt: new Date(),
  };
}

async function fetchWalletBalanceSnapshot(wallet: Pick<WalletRow, 'address' | 'chain' | 'walletType'>): Promise<BalanceSnapshot> {
  if (wallet.walletType === 'EVM') {
    const balance = await getWalletBalance(wallet.address, wallet.chain);
    return { ...balance, updatedAt: new Date() };
  }

  if (wallet.walletType === 'SOLANA') return fetchSolanaBalance(wallet.address);
  if (wallet.walletType === 'BITCOIN') return fetchBitcoinBalance(wallet.address);
  return { balance: '0', symbol: 'UNKNOWN', updatedAt: new Date() };
}

async function storeBalance(walletId: string, userId: string, snapshot: BalanceSnapshot) {
  const [updated] = await getDb()
    .update(wallets)
    .set({
      balance: snapshot.balance,
      balanceSymbol: snapshot.symbol,
      balanceUpdatedAt: snapshot.updatedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)))
    .returning();

  return updated;
}

export async function importWallet(userId: string, data: { privateKey: string; nickname?: string | null }) {
  // Auto-detect wallet type from private key format
  let walletType: ImportWalletType = 'EVM';
  
  // Try to detect wallet type by attempting to derive from each type
  try {
    // Try EVM first (most common)
    deriveWalletFromPrivateKey('EVM', data.privateKey);
    walletType = 'EVM';
  } catch {
    try {
      // Try Solana
      deriveWalletFromPrivateKey('SOLANA', data.privateKey);
      walletType = 'SOLANA';
    } catch {
      try {
        // Try Bitcoin
        deriveWalletFromPrivateKey('BITCOIN', data.privateKey);
        walletType = 'BITCOIN';
      } catch {
        throw new Error('Invalid private key format. Could not detect wallet type (EVM, Solana, or Bitcoin).');
      }
    }
  }

  const derived = deriveWalletFromPrivateKey(walletType, data.privateKey);

  const [existing] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.address, derived.address)))
    .limit(1);

  if (existing) throw new Error('Wallet already added');

  const [existingUserWallet] = await getDb()
    .select({ id: wallets.id })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);

  const encrypted = encryptPrivateKey(derived.privateKey);
  const initialWallet = {
    userId,
    address: derived.address,
    nickname: data.nickname || null,
    chain: DEFAULT_EVM_CHAIN,
    walletType: derived.walletType,
    encryptedPrivateKey: encrypted,
    encryptionVersion: 1,
    isDefault: !existingUserWallet,
  };

  const balance = await fetchWalletBalanceSnapshot(initialWallet);

  const [wallet] = await getDb().insert(wallets).values({
    ...initialWallet,
    balance: balance.balance,
    balanceSymbol: balance.symbol,
    balanceUpdatedAt: balance.updatedAt,
  }).returning();

  if (wallet.isDefault) {
    await getDb()
      .insert(executionSettings)
      .values({ userId, defaultWalletId: wallet.walletType === 'EVM' ? wallet.id : null })
      .onConflictDoUpdate({
        target: executionSettings.userId,
        set: { defaultWalletId: wallet.walletType === 'EVM' ? wallet.id : null, updatedAt: new Date() },
      });
  }

  await getDb().insert(walletPermissions).values({
    userId,
    walletId: wallet.id,
    canMint: wallet.walletType === 'EVM',
    canMonitor: true,
  });

  await logActivity(userId, 'wallet_imported', 'Wallet imported', {
    walletId: wallet.id,
    address: wallet.address,
    walletType: wallet.walletType,
  });

  const publicWallet = await getPublicWalletById(wallet.id, userId);
  if (!publicWallet) throw new Error('Failed to load imported wallet');
  return publicWallet;
}

/** Redis key for the decryption pre-warm cache. Scoped to walletId + userId. */
function walletKeyCacheKey(walletId: string, userId: string): string {
  return `wallet:key-cache:${userId}:${walletId}`;
}

/**
 * Pre-warm the wallet decryption cache.
 *
 * Speed fix: Call this when a task transitions to 'ready' (before execution starts).
 * executeMint will find the key in Redis and skip the DB lookup + AES decrypt,
 * saving 50–150ms on the hot execution path.
 *
 * Security: the key is stored RE-ENCRYPTED (not as plaintext) so it is safe at
 * rest in Redis. TTL = 5 minutes — long enough for any mint window, short enough
 * to limit exposure. Cache key is scoped to (userId, walletId) so cross-user
 * access is structurally impossible.
 */
export async function prewarmWalletKey(walletId: string, userId: string): Promise<void> {
  try {
    const cacheKey = walletKeyCacheKey(walletId, userId);
    // Check if already cached to avoid unnecessary DB + crypto work
    const existing = await getCache<string>(cacheKey).catch(() => null);
    if (existing) return;

    // Decrypt from DB, then re-encrypt for Redis storage
    const [wallet] = await getDb()
      .select({ encryptedPrivateKey: wallets.encryptedPrivateKey })
      .from(wallets)
      .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)))
      .limit(1);

    if (!wallet?.encryptedPrivateKey) return; // don't throw — this is a best-effort warm
    const plainKey = decryptPrivateKey(wallet.encryptedPrivateKey);
    // Re-encrypt before storing in Redis
    const reEncrypted = encryptPrivateKey(plainKey);
    await setCache(cacheKey, reEncrypted, 5 * 60); // 5-minute TTL
  } catch {
    // Non-fatal — executeMint falls back to DB if cache miss
  }
}

export async function getDecryptedPrivateKey(walletId: string, userId: string): Promise<string> {
  // Speed fix: check Redis pre-warm cache first (populated by prewarmWalletKey).
  // On a cache hit, we skip the DB query and AES decrypt, saving 50–150ms.
  try {
    const cacheKey = walletKeyCacheKey(walletId, userId);
    const cached = await getCache<string>(cacheKey).catch(() => null);
    if (cached) {
      // Decrypt the re-encrypted cached value
      return decryptPrivateKey(cached);
    }
  } catch {
    // Cache read failed — fall through to DB path
  }

  const [wallet] = await getDb()
    .select({
      encryptedPrivateKey: wallets.encryptedPrivateKey,
    })
    .from(wallets)
    .where(and(eq(wallets.id, walletId), eq(wallets.userId, userId)))
    .limit(1);

  if (!wallet) throw new Error('Wallet not found');
  if (!wallet.encryptedPrivateKey) throw new Error('Wallet does not have an imported private key');

  return decryptPrivateKey(wallet.encryptedPrivateKey);
}

export async function removeWallet(id: string, userId: string) {
  const existing = await getWalletById(id, userId);
  if (!existing) throw new Error('Wallet not found');

  await getDb().delete(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId)));

  if (existing.isDefault) {
    await getDb()
      .update(executionSettings)
      .set({ defaultWalletId: null, updatedAt: new Date() })
      .where(eq(executionSettings.userId, userId));
  }

  await logActivity(userId, 'wallet_removed', 'Wallet removed', {
    walletId: id,
    address: existing.address,
    walletType: existing.walletType,
  });

  return { success: true };
}

export async function updateWallet(id: string, userId: string, data: { nickname?: string | null }) {
  const existing = await getWalletById(id, userId);
  if (!existing) throw new Error('Wallet not found');

  const [updated] = await getDb()
    .update(wallets)
    .set({
      nickname: data.nickname ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(wallets.id, id), eq(wallets.userId, userId)))
    .returning();

  const publicWallet = await getPublicWalletById(updated.id, userId);
  if (!publicWallet) throw new Error('Wallet not found');
  return publicWallet;
}

export async function setDefaultWallet(id: string, userId: string) {
  const existing = await getWalletById(id, userId);
  if (!existing) throw new Error('Wallet not found');

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
    .values({ userId, defaultWalletId: updated.walletType === 'EVM' ? updated.id : null })
    .onConflictDoUpdate({
      target: executionSettings.userId,
      set: { defaultWalletId: updated.walletType === 'EVM' ? updated.id : null, updatedAt: new Date() },
    });

  const publicWallet = await getPublicWalletById(updated.id, userId);
  if (!publicWallet) throw new Error('Wallet not found');
  return publicWallet;
}

export async function refreshWalletBalance(id: string, userId: string) {
  const wallet = await getWalletById(id, userId);
  if (!wallet) throw new Error('Wallet not found');

  const snapshot = await fetchWalletBalanceSnapshot(wallet);
  const updated = await storeBalance(id, userId, snapshot);
  return {
    wallet: toPublicWallet({ ...updated, pendingScheduledTasks: 0 }),
    balance: {
      balance: snapshot.balance,
      symbol: snapshot.symbol,
      updatedAt: snapshot.updatedAt.toISOString(),
    },
  };
}

export async function fetchBalance(address: string, chain: string) {
  try {
    const balance = await getWalletBalance(address, chain);
    return { success: true, balance };
  } catch {
    return { success: false, balance: null, error: 'Failed to fetch balance' };
  }
}

// ─── Default mint wallet resolution ──────────────────────────────
// Shared utility used by copy-mint and whale-consensus flows.
// Tries chain-specific wallet first, then falls back to any EVM wallet.
export async function getDefaultMintWallet(
  userId: string,
  chain: string,
  destinationWalletId?: string | null,
) {
  const db = getDb();
  const chainTyped = chain as 'ethereum' | 'base' | 'polygon';

  if (destinationWalletId) {
    const [dest] = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.id, destinationWalletId), eq(wallets.walletType, 'EVM')))
      .limit(1);
    if (dest) return dest;
  }

  const [sameChain] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, chainTyped), eq(wallets.walletType, 'EVM')))
    .orderBy(wallets.createdAt)
    .limit(1);

  if (sameChain) return sameChain;

  addBreadcrumb({
    category: 'wallet',
    message: `getDefaultMintWallet: no wallet on chain "${chain}" — falling back to first EVM wallet`,
    level: 'warning',
    data: { userId, chain },
  });

  const [fallback] = await db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.walletType, 'EVM')))
    .orderBy(wallets.createdAt)
    .limit(1);

  return fallback ?? null;
}

