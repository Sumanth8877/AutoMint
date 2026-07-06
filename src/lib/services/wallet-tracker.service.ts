import 'server-only';

import crypto from 'crypto';
import { normalizeAddress, isValidEvmAddress } from '@/lib/utils/address';
import { and, eq, inArray } from 'drizzle-orm';
import { watchedWallets } from '@/drizzle/schema';
import { getDb } from '@/lib/db';
import { logActivity } from '@/lib/monitoring';
import { ConflictError } from '@/lib/api/errors';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type SupportedChain = 'ethereum' | 'base' | 'polygon' | 'arbitrum';
export type WatchedWalletNetworkType = 'EVM' | 'SOLANA' | 'BITCOIN';

type AlchemyWebhookActivity = {
  fromAddress?: string;
  toAddress?: string;
  contractAddress?: string;
  hash?: string;
  transactionHash?: string;
  tokenId?: string;
  category?: string;
  type?: string;
  eventType?: string;
  asset?: string;
  value?: string | number;
  erc1155Metadata?: Array<{ tokenId?: string; value?: string }>;
  log?: {
    transactionHash?: string;
    address?: string;
  };
  rawContract?: {
    address?: string;
  };
};

type AlchemyWebhookPayload = {
  event?: {
    network?: string;
    activity?: AlchemyWebhookActivity[];
  };
  network?: string;
  activity?: AlchemyWebhookActivity[];
};

type WalletTrackerEventType = 'mint' | 'purchase' | 'transfer';

export type WalletTrackerEvent = {
  type: WalletTrackerEventType;
  walletAddress: string;
  chain: SupportedChain;
  contractAddress?: string;
  tokenId?: string;
  transactionHash?: string;
};

function normalizeWalletAddress(address: string, networkType: WatchedWalletNetworkType) {
  return networkType === 'EVM' ? normalizeAddress(address) : address.trim();
}

function isValidSolanaAddress(address: string) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function isValidBitcoinAddress(address: string) {
  return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,90}$/.test(address);
}

function normalizeNetworkType(networkType: string | undefined): WatchedWalletNetworkType {
  const value = (networkType || 'EVM').trim().toUpperCase();
  if (value === 'SOLANA') return 'SOLANA';
  if (value === 'BITCOIN') return 'BITCOIN';
  return 'EVM';
}

function validateAddress(address: string, networkType: WatchedWalletNetworkType) {
  if (networkType === 'EVM') return isValidEvmAddress(address);
  if (networkType === 'SOLANA') return isValidSolanaAddress(address);
  return isValidBitcoinAddress(address);
}

// Fix #2: previously had no Arbitrum branch, so watching/detecting an
// Arbitrum wallet silently recorded it (and matched incoming webhook
// activity) as Ethereum. Arbitrum's network identifiers ("arb-mainnet",
// "arbitrum-one", "arbitrum") are now matched explicitly, same pattern as
// the other chains.
function normalizeChain(chain: string | undefined): SupportedChain {
  const value = (chain || 'ethereum').toLowerCase();
  if (value.includes('base')) return 'base';
  if (value.includes('polygon') || value.includes('matic')) return 'polygon';
  if (value.includes('arbitrum') || value.includes('arb-')) return 'arbitrum';
  return 'ethereum';
}

function getAlchemyWebhookId(chain: SupportedChain) {
  return process.env[`ALCHEMY_${chain.toUpperCase()}_WALLET_WEBHOOK_ID`] || process.env.ALCHEMY_WALLET_WEBHOOK_ID;
}

function getAlchemyNotifyToken() {
  return process.env.ALCHEMY_NOTIFY_AUTH_TOKEN || process.env.ALCHEMY_AUTH_TOKEN;
}

async function updateAlchemyWebhookAddresses(params: {
  chain: SupportedChain;
  add?: string[];
  remove?: string[];
}) {
  const webhookId = getAlchemyWebhookId(params.chain);
  const token = getAlchemyNotifyToken();

  if (!webhookId || !token) {
    return { synced: false, reason: 'alchemy_webhook_not_configured' };
  }

  const response = await fetch('https://dashboard.alchemy.com/api/update-webhook-addresses', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Alchemy-Token': token,
    },
    body: JSON.stringify({
      webhook_id: webhookId,
      addresses_to_add: params.add ?? [],
      addresses_to_remove: params.remove ?? [],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(text || `Alchemy webhook update failed with status ${response.status}`);
    throw error;
  }

  return { synced: true };
}

async function sendWalletTrackerNotification(
  userId: string,
  type: 'wallet_minted_nft' | 'wallet_purchased_nft',
  payload: {
    wallet?: string;
    contractAddress?: string;
    txHash?: string;
  },
) {
  const { sendTelegramNotification } = await import('@/lib/services/telegram.service');
  return sendTelegramNotification(userId, type, payload);
}

export function verifyAlchemyWebhookSignature(headers: Headers, rawBody: string) {
  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    throw new Error('Webhook signature verification is not configured');
  }

  const signature = headers.get('x-alchemy-signature');
  if (!signature) throw new Error('Missing Alchemy webhook signature');

  const expected = crypto.createHmac('sha256', signingKey).update(rawBody).digest('hex');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error('Invalid Alchemy webhook signature');
  }

  return true;
}

export async function watchWallet(userId: string, data: { walletAddress: string; chain?: string; walletName?: string | null; networkType?: string }) {
  const networkType = normalizeNetworkType(data.networkType);
  const walletAddress = normalizeWalletAddress(data.walletAddress, networkType);
  if (!validateAddress(walletAddress, networkType)) throw new Error('Invalid wallet address');

  const chain = normalizeChain(data.chain);

  // Block duplicates with a clear error instead of silently reactivating an
  // existing row. Users should use the pause/resume or edit controls to
  // manage a wallet they're already tracking, not "add" it again.
  const [existing] = await getDb()
    .select({ id: watchedWallets.id })
    .from(watchedWallets)
    .where(and(
      eq(watchedWallets.userId, userId),
      eq(watchedWallets.walletAddress, walletAddress),
      eq(watchedWallets.chain, chain),
    ))
    .limit(1);

  if (existing) {
    throw new ConflictError('This wallet is already tracked. Use the pause/resume or edit controls instead of adding it again.');
  }

  const [wallet] = await getDb()
    .insert(watchedWallets)
    .values({
      userId,
      walletName: data.walletName?.trim() || null,
      walletAddress,
      networkType,
      chain,
      active: true,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [watchedWallets.userId, watchedWallets.walletAddress, watchedWallets.chain],
    })
    .returning();

  if (!wallet) {
    // Race: another request inserted the same wallet between our check and this insert.
    throw new ConflictError('This wallet is already tracked. Use the pause/resume or edit controls instead of adding it again.');
  }

  if (networkType === 'EVM') {
    // Non-blocking: a failed Alchemy sync (e.g. stale/misconfigured webhook ID)
    // must not stop the wallet from being tracked — it just means real-time
    // detection falls back to polling instead of the instant webhook.
    try {
      const registration = await updateAlchemyWebhookAddresses({ chain, add: [walletAddress] });
      if (!registration.synced) {
      }
    } catch (_error) {
    }
  }
  await logActivity(userId, 'wallet_added', 'Wallet tracker enabled', { walletAddress, chain });

  return wallet;
}

export async function unwatchWallet(userId: string, data: { walletAddress: string; chain?: string }) {
  const walletAddress = normalizeAddress(data.walletAddress);
  const chain = normalizeChain(data.chain);

  const [wallet] = await getDb()
    .update(watchedWallets)
    .set({ active: false, updatedAt: new Date() })
    .where(and(
      eq(watchedWallets.userId, userId),
      eq(watchedWallets.walletAddress, walletAddress),
      eq(watchedWallets.chain, chain),
    ))
    .returning();

  if (!wallet) throw new Error('Watched wallet not found');

  const [stillWatched] = await getDb()
    .select({ id: watchedWallets.id })
    .from(watchedWallets)
    .where(and(
      eq(watchedWallets.walletAddress, walletAddress),
      eq(watchedWallets.chain, chain),
      eq(watchedWallets.active, true),
    ))
    .limit(1);

  if (!stillWatched && wallet.networkType === 'EVM') {
    // Same non-blocking treatment as watchWallet — don't let a stale/misconfigured
    // Alchemy webhook prevent the user from un-tracking a wallet.
    try {
      await updateAlchemyWebhookAddresses({ chain, remove: [walletAddress] });
    } catch (_error) {
    }
  }

  await logActivity(userId, 'wallet_removed', 'Wallet tracker disabled', { walletAddress, chain });
  return wallet;
}

export async function getUserWatchedWallets(userId: string) {
  return getDb()
    .select()
    .from(watchedWallets)
    .where(eq(watchedWallets.userId, userId));
}

export async function updateWatchedWallet(userId: string, id: string, data: { walletName?: string | null; active?: boolean }) {
  const [wallet] = await getDb()
    .update(watchedWallets)
    .set({
      ...(data.walletName !== undefined ? { walletName: data.walletName?.trim() || null } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(watchedWallets.userId, userId), eq(watchedWallets.id, id)))
    .returning();

  if (!wallet) throw new Error('Watched wallet not found');
  await logActivity(userId, data.active === false ? 'wallet_removed' : 'wallet_added', data.active === false ? 'Wallet tracker paused' : 'Wallet tracker updated', {
    walletAddress: wallet.walletAddress,
    chain: wallet.chain,
    active: wallet.active,
  });

  return wallet;
}

export async function deleteWatchedWallet(userId: string, id: string) {
  const [wallet] = await getDb()
    .delete(watchedWallets)
    .where(and(eq(watchedWallets.userId, userId), eq(watchedWallets.id, id)))
    .returning();

  if (!wallet) throw new Error('Watched wallet not found');

  if (wallet.active && wallet.networkType === 'EVM') {
    const [stillWatched] = await getDb()
      .select({ id: watchedWallets.id })
      .from(watchedWallets)
      .where(and(
        eq(watchedWallets.walletAddress, wallet.walletAddress),
        eq(watchedWallets.chain, wallet.chain),
        eq(watchedWallets.active, true),
      ))
      .limit(1);

    if (!stillWatched) {
      // Non-blocking, same as watchWallet/unwatchWallet — a failed Alchemy
      // sync must not stop the wallet from being deleted; it just means the
      // stale address lingers on the webhook until the next successful sync.
      try {
        await updateAlchemyWebhookAddresses({ chain: wallet.chain, remove: [wallet.walletAddress] });
      } catch (_error) {
      }
    }
  }

  await logActivity(userId, 'wallet_removed', 'Wallet tracker deleted', { walletAddress: wallet.walletAddress, chain: wallet.chain });
  return wallet;
}

function hasPurchaseHint(activity: AlchemyWebhookActivity) {
  const type = `${activity.type ?? ''} ${activity.eventType ?? ''} ${activity.category ?? ''}`.toLowerCase();
  if (type.includes('sale') || type.includes('purchase')) return true;

  const value = Number(activity.value ?? '0');
  return Number.isFinite(value) && value > 0;
}

function classifyActivity(activity: AlchemyWebhookActivity, walletAddress: string): WalletTrackerEventType | null {
  const from = normalizeAddress(activity.fromAddress || '');
  const to = normalizeAddress(activity.toAddress || '');

  if (to === walletAddress && from === ZERO_ADDRESS) return 'mint';
  if (to === walletAddress && hasPurchaseHint(activity)) return 'purchase';
  if (from === walletAddress || to === walletAddress) return 'transfer';
  return null;
}

function getActivityContract(activity: AlchemyWebhookActivity) {
  return normalizeAddress(activity.contractAddress || activity.rawContract?.address || activity.log?.address || '');
}

function getActivityHash(activity: AlchemyWebhookActivity) {
  return activity.hash || activity.transactionHash || activity.log?.transactionHash;
}

async function loadWatchers(addresses: string[], chain: SupportedChain) {
  if (addresses.length === 0) return [];

  return getDb()
    .select()
    .from(watchedWallets)
    .where(and(
      inArray(watchedWallets.walletAddress, addresses),
      eq(watchedWallets.chain, chain),
      eq(watchedWallets.active, true),
    ));
}

export async function handleAlchemyWalletWebhook(payload: AlchemyWebhookPayload) {
  try {
  const chain = normalizeChain(payload.event?.network ?? payload.network);
  const activities = payload.event?.activity ?? payload.activity ?? [];
  const candidateAddresses = Array.from(new Set(activities.flatMap((activity) => [
    activity.fromAddress ? normalizeAddress(activity.fromAddress) : null,
    activity.toAddress ? normalizeAddress(activity.toAddress) : null,
  ]).filter((address): address is string => Boolean(address && isValidEvmAddress(address)))));

  const watchers = await loadWatchers(candidateAddresses, chain);
  const watcherByAddress = new Map(watchers.map((watcher) => [watcher.walletAddress, watcher]));
  const events: WalletTrackerEvent[] = [];

  for (const activity of activities) {
    const addresses = [
      activity.fromAddress ? normalizeAddress(activity.fromAddress) : null,
      activity.toAddress ? normalizeAddress(activity.toAddress) : null,
    ].filter((address): address is string => Boolean(address));

    for (const address of addresses) {
      const trustedType = classifyActivity(activity, address);
      const trustedContract = getActivityContract(activity);
      if (trustedType === 'mint' && trustedContract) {
      }

      const watcher = watcherByAddress.get(address);
      if (!watcher) continue;

      const type = classifyActivity(activity, watcher.walletAddress);
      if (!type) continue;

      const event = {
        type,
        walletAddress: watcher.walletAddress,
        chain,
        contractAddress: getActivityContract(activity) || undefined,
        tokenId: activity.tokenId ?? activity.erc1155Metadata?.[0]?.tokenId,
        transactionHash: getActivityHash(activity),
      };
      events.push(event);

      if (type === 'mint') {
        await logActivity(watcher.userId, 'wallet_balance_changed', 'Wallet Minted NFT', event);
        await sendWalletTrackerNotification(watcher.userId, 'wallet_minted_nft', {
          wallet: watcher.walletAddress,
          contractAddress: event.contractAddress,
          txHash: event.transactionHash,
        });

        if (event.contractAddress) {
          const { handleCopyMintEvent } = await import('@/lib/services/copy-mint.service');
          try {
            await handleCopyMintEvent({
            userId: watcher.userId,
            watchedWalletAddress: watcher.walletAddress,
            chain,
            contractAddress: event.contractAddress,
            tokenId: event.tokenId,
            transactionHash: event.transactionHash,
          });
          } catch (_error) {
          }
        }
      }

      if (type === 'purchase') {
        await logActivity(watcher.userId, 'wallet_balance_changed', 'Wallet Purchased NFT', event);
        await sendWalletTrackerNotification(watcher.userId, 'wallet_purchased_nft', {
          wallet: watcher.walletAddress,
          contractAddress: event.contractAddress,
          txHash: event.transactionHash,
        });
      }
    }
  }

  return { processed: events.length, events };
  } catch (error) {
    throw error;
  }
}
