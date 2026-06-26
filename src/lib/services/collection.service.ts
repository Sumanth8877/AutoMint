import { getDb } from '@/lib/db';
import { collections } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { getCollectionMetadata } from '@/lib/blockchain/collections';
import { logActivity } from '@/lib/monitoring';
import { captureException } from '@/lib/observability/sentry';
import { ConflictError, NotFoundError } from '@/lib/api/errors';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

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

  return collection;
}

export async function removeCollection(id: string, userId: string) {
  const existing = await getDb().select().from(collections).where(and(eq(collections.id, id), eq(collections.userId, userId))).limit(1);
  if (existing.length === 0) throw new NotFoundError('Collection not found');

  await getDb().delete(collections).where(and(eq(collections.id, id), eq(collections.userId, userId)));
  return { success: true };
}
