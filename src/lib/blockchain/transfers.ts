import { getClient } from './client';
import { getCache, setCache, CACHE_KEYS, CACHE_TTL } from '@/lib/redis';
import { parseAbiItem, type Hex } from 'viem';
import { captureException } from '@/lib/observability/sentry';

export interface NftTransfer {
  tokenId: string;
  from: string;
  to: string;
  contract: string;
  chain: string;
  blockNumber: number;
  txHash: string;
  timestamp?: string;
}

const ERC721_TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');

export async function getNftTransfers(params: {
  chain: string;
  contract: string;
  fromBlock?: number;
  toBlock?: number;
  limit?: number;
  tokenId?: string;   // when provided, filters logs to this specific token
}): Promise<NftTransfer[]> {
  const client = getClient(params.chain);

  const latestBlock = await client.getBlockNumber();
  const fromBlock = BigInt(params.fromBlock ?? Number(latestBlock - BigInt(5000)));
  const toBlock = BigInt(params.toBlock ?? Number(latestBlock));

  const logs = await client.getLogs({
    address: params.contract as Hex,
    event: ERC721_TRANSFER_EVENT,
    fromBlock,
    toBlock,
    // Filter at RPC level when tokenId is provided — avoids fetching all
    // transfers and filtering client-side, which returns wrong owner when
    // the most-recent transfer in the window is for a different tokenId.
    ...(params.tokenId !== undefined && {
      args: { tokenId: BigInt(params.tokenId) },
    }),
  });

  return logs.slice(0, params.limit || 100).map((log) => {
    return {
      tokenId: log.args.tokenId?.toString() ?? '0',
      from: log.args.from ?? '',
      to: log.args.to ?? '',
      contract: params.contract,
      chain: params.chain,
      blockNumber: Number(log.blockNumber),
      txHash: log.transactionHash,
    };
  });
}

export async function getLatestOwner(params: { chain: string; contract: string; tokenId?: string }): Promise<string | null> {
  const cacheKey = CACHE_KEYS.owners(params.contract, params.chain, params.tokenId);
  const cached = await getCache<{ owner: string; blockNumber: number }>(cacheKey);
  if (cached) return cached.owner;

  try {
    const transfers = await getNftTransfers({
      chain: params.chain,
      contract: params.contract,
      tokenId: params.tokenId,  // filter to this token — fixes wrong-owner bug
      limit: 1,
    });

    if (transfers.length === 0) return null;

    const latest = transfers[0];
    await setCache(cacheKey, { owner: latest.to, blockNumber: latest.blockNumber }, CACHE_TTL.owners);

    return latest.to;
  } catch (error) {
    captureException(error, { area: 'transfers', context: {}, fingerprint: ['transfers', 'latest-owner-error'] });
    return null;
  }
}

export async function getCollectionStats(params: { chain: string; contract: string }): Promise<{
  holders: number;
  volume: string;
  transferCount: number;
  lastActivity?: string;
}> {
  const cacheKey = CACHE_KEYS.collectionStats(params.contract, params.chain);
  const cached = await getCache<{ holders: number; volume: string; transferCount: number }>(cacheKey);
  if (cached) return cached;

  try {
    const transfers = await getNftTransfers({
      chain: params.chain,
      contract: params.contract,
      limit: 1000,
    });

    const uniqueHolders = new Set(transfers.map((t) => t.to));
    const volume = '0';
    const lastActivity = transfers[0]?.timestamp;

    const stats = {
      holders: uniqueHolders.size,
      volume,
      transferCount: transfers.length,
      lastActivity,
    };

    await setCache(cacheKey, stats, CACHE_TTL.collectionStats);

    return stats;
  } catch (error) {
    captureException(error, { area: 'transfers', context: {}, fingerprint: ['transfers', 'collection-stats-error'] });
    return { holders: 0, volume: '0', transferCount: 0 };
  }
}
