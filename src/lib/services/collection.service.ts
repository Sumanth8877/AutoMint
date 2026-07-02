import { getDb } from '@/lib/db';
import { collections } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { getCollectionMetadata } from '@/lib/blockchain/collections';
import { logActivity } from '@/lib/monitoring';
import { captureException } from '@/lib/observability/sentry';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { CHAIN_KEYS, type ChainKey } from '@/lib/blockchain/chains';
import { fetchCollectionIntelligence } from '@/lib/services/analyzer-market-intelligence.service';
import type { MintIntent } from '@/lib/resolve-mint-intent';

// Fix #2: this used to be a hand-rolled `['ethereum', 'base', 'polygon']`
// tuple that silently rejected Arbitrum ("Unsupported chain") even though
// chains.ts already supports it. Derive from the single source of truth so
// adding a chain to chains.ts is the only place that needs to change.
const SUPPORTED_CHAINS = CHAIN_KEYS;
type SupportedChain = ChainKey;

export async function getUserCollections(userId: string) {
  const result = await getDb().select().from(collections).where(eq(collections.userId, userId)).orderBy(collections.createdAt);
  return result;
}

export async function addCollection(userId: string, data: { name: string; contractAddress: string; chain: string }) {
  const contractAddress = data.contractAddress.toLowerCase();

  if (!data.name || !contractAddress || !data.chain) {
    throw new Error('Name, contractAddress, and chain are required');
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    throw new Error('Invalid contract address format');
  }

  if (!SUPPORTED_CHAINS.includes(data.chain as SupportedChain)) {
    throw new Error(`Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
  }

  const [existing] = await getDb()
    .select({ id: collections.id })
    .from(collections)
    .where(and(eq(collections.userId, userId), eq(collections.contractAddress, contractAddress), eq(collections.chain, data.chain as SupportedChain)))
    .limit(1);

  if (existing) {
    throw new ConflictError('Collection already added');
  }

  let [collection] = await getDb().insert(collections).values({
    userId,
    name: data.name,
    contractAddress,
    chain: data.chain as SupportedChain,
  }).returning();

  // Best-effort metadata sync
  try {
    const metadata = await getCollectionMetadata(data.contractAddress, data.chain);
    const [syncedCollection] = await getDb().update(collections)
      .set({
        name: metadata.name,
        tokenStandard: metadata.tokenStandard,
        owner: metadata.owner,
        totalSupply: metadata.totalSupply.toString(),
        lastSyncedAt: new Date(),
      })
      .where(eq(collections.id, collection.id))
      .returning();

    if (syncedCollection) collection = syncedCollection;
  } catch (error) {
    captureException(error, { area: 'collection', context: {}, fingerprint: ['collection', 'metadata-sync-failed'] });
  }

  await logActivity(userId, 'collection_added', 'Collection added', {
    collectionId: collection.id,
    contractAddress: collection.contractAddress,
    chain: collection.chain,
  });

  // Best-effort floor price sync -- never blocks collection creation
  void syncCollectionFloorPrice(collection.id, collection.contractAddress, collection.chain, collection.name).catch(() => {});

  return collection;
}

/**
 * Find-or-create a tracked collection for a contract, without throwing if
 * it already exists. Used when a mint completes successfully so the
 * collection shows up on the Collections page even if the user minted a
 * contract that was never explicitly "added" first.
 */
export async function ensureCollectionForMint(
  userId: string,
  data: { contractAddress: string; chain: string; name?: string | null },
) {
  const contractAddress = data.contractAddress.toLowerCase();
  const chain = SUPPORTED_CHAINS.includes(data.chain as SupportedChain) ? (data.chain as SupportedChain) : 'ethereum';

  const [existing] = await getDb()
    .select()
    .from(collections)
    .where(and(eq(collections.userId, userId), eq(collections.contractAddress, contractAddress), eq(collections.chain, chain)))
    .limit(1);

  if (existing) return existing;

  let name = data.name || 'Unnamed Collection';
  try {
    const metadata = await getCollectionMetadata(contractAddress, chain);
    name = data.name || metadata.name || name;

    const [inserted] = await getDb().insert(collections).values({
      userId,
      name,
      contractAddress,
      chain,
      tokenStandard: metadata.tokenStandard,
      owner: metadata.owner,
      totalSupply: metadata.totalSupply.toString(),
      lastSyncedAt: new Date(),
    }).onConflictDoNothing().returning();

    if (inserted) {
      await logActivity(userId, 'collection_added', 'Collection added from successful mint', {
        collectionId: inserted.id,
        contractAddress: inserted.contractAddress,
        chain: inserted.chain,
      });
      void syncCollectionFloorPrice(inserted.id, inserted.contractAddress, inserted.chain, inserted.name).catch(() => {});
      return inserted;
    }
  } catch (error) {
    captureException(error, { area: 'collection', context: { contractAddress, chain }, fingerprint: ['collection', 'ensure-for-mint-metadata-failed'] });
  }

  // onConflictDoNothing returned nothing (race with a concurrent insert) or
  // metadata lookup failed before insert -- fall back to a minimal insert / re-select.
  const [fallback] = await getDb().insert(collections).values({
    userId,
    name,
    contractAddress,
    chain,
  }).onConflictDoNothing().returning();

  if (fallback) {
    void syncCollectionFloorPrice(fallback.id, fallback.contractAddress, fallback.chain, fallback.name).catch(() => {});
    return fallback;
  }

  const [reSelected] = await getDb()
    .select()
    .from(collections)
    .where(and(eq(collections.userId, userId), eq(collections.contractAddress, contractAddress), eq(collections.chain, chain)))
    .limit(1);

  return reSelected ?? null;
}

/**
 * Refreshes floor price + floor movement for a tracked collection using the
 * same multi-provider market intelligence pipeline the Analyzer uses
 * (OpenSea / Alchemy / Moralis). Shifts the current floor price into
 * `previousFloorPrice` before overwriting, so the UI can render a
 * up/down movement indicator. Best-effort -- swallows provider failures.
 */
export async function syncCollectionFloorPrice(
  collectionId: string,
  contractAddress: string,
  chain: string,
  collectionName?: string | null,
) {
  try {
    const metadata = await getCollectionMetadata(contractAddress, chain);
    const intent: MintIntent = {
      sourceUrl: `https://contract/${chain}/${contractAddress}`,
      contractAddress,
      chain,
      collectionName: collectionName || metadata.name || undefined,
      isValid: true,
      confidence: 1,
      sourcePlatform: 'contract',
    };

    const intelligence = await fetchCollectionIntelligence({
      intent,
      metadata: { ...metadata, totalSupply: metadata.totalSupply.toString() },
      log: () => {},
      timingBreakdown: [],
    });

    if (!intelligence.floorPrice) return null;

    const [current] = await getDb().select({ floorPrice: collections.floorPrice }).from(collections).where(eq(collections.id, collectionId)).limit(1);

    // Compute movement ourselves by comparing the newly fetched floor price
    // against what we had stored last sync -- fetchCollectionIntelligence
    // doesn't expose a change percent, only the raw floor price.
    let floorChangePercent: string | null = null;
    const previousNumeric = current?.floorPrice ? parseFloat(current.floorPrice.replace(/[^\d.-]/g, '')) : NaN;
    const newNumeric = parseFloat(intelligence.floorPrice.replace(/[^\d.-]/g, ''));
    if (!Number.isNaN(previousNumeric) && !Number.isNaN(newNumeric) && previousNumeric > 0) {
      const change = ((newNumeric - previousNumeric) / previousNumeric) * 100;
      floorChangePercent = (change >= 0 ? '+' : '') + change.toFixed(2);
    }

    const now = new Date();
    const [updated] = await getDb().update(collections)
      .set({
        previousFloorPrice: current?.floorPrice ?? null,
        floorPrice: intelligence.floorPrice,
        floorChangePercent,
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(collections.id, collectionId))
      .returning();

    return updated ?? null;
  } catch (error) {
    captureException(error, { area: 'collection', context: { collectionId, contractAddress, chain }, fingerprint: ['collection', 'floor-sync-failed'] });
    return null;
  }
}

export async function removeCollection(id: string, userId: string) {
  const existing = await getDb().select().from(collections).where(and(eq(collections.id, id), eq(collections.userId, userId))).limit(1);
  if (existing.length === 0) throw new NotFoundError('Collection not found');

  await getDb().delete(collections).where(and(eq(collections.id, id), eq(collections.userId, userId)));
  return { success: true };
}
