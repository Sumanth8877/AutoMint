import 'server-only';

import { captureException } from '@/lib/observability/sentry';

type NFTScanCollectionResponse = {
  code: number;
  msg: string;
  data: {
    contract_address: string;
    name: string;
    symbol: string;
    contract_type: string;
    owner_count: number;
    total_supply: number;
    total_volume: string;
    floor_price: string;
    floor_price_symbol: string;
    logo: string;
    description: string;
    website: string;
    twitter: string;
    discord: string;
    telegram: string;
    is_verified: boolean;
  };
};

type NFTScanTradesResponse = {
  code: number;
  msg: string;
  data: Array<{
    transaction_hash: string;
    transaction_type: string;
    from_address: string;
    to_address: string;
    amount: string;
    amount_usd: string;
    price: string;
    price_usd: string;
    token_address: string;
    token_id: string;
    block_number: number;
    block_timestamp: number;
    trade_time: number;
  }>;
};

type NFTScanOwnersResponse = {
  code: number;
  msg: string;
  data: Array<{
    owner: string;
    token_amount: number;
  }>;
};

type NFTScanStatisticsResponse = {
  code: number;
  msg: string;
  data: {
    total_volume: string;
    total_volume_usd: string;
    total_trade_count: number;
    total_holder_count: number;
    one_day_volume: string;
    one_day_volume_usd: string;
    one_day_trade_count: number;
    seven_day_volume: string;
    seven_day_volume_usd: string;
    seven_day_trade_count: number;
    thirty_day_volume: string;
    thirty_day_volume_usd: string;
    thirty_day_trade_count: number;
  };
};

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'eth',
  base: 'base',
  polygon: 'polygon',
  bsc: 'bnb',
  arbitrum: 'arb',
  optimism: 'op',
  avalanche: 'avax',
  fantom: 'ftm',
};

function getChain(chain: string): string {
  return CHAIN_MAP[chain.toLowerCase()] || chain.toLowerCase();
}

async function fetchNFTScan<T>(endpoint: string): Promise<T | null> {
  const apiKey = process.env.NFTSCAN_API_KEY;
  if (!apiKey) {
    console.warn('NFTScan API key not found, skipping request');
    return null;
  }

  try {
    const response = await fetch(`https://api.nftscan.com${endpoint}`, {
      headers: {
        'Accept': 'application/json',
        'X-API-KEY': apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error(`NFTScan API failed with status ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (data.code !== 200) {
      console.error(`NFTScan API returned error: ${data.msg}`);
      return null;
    }

    return data;
  } catch (error) {
    console.error('NFTScan API request failed:', error);
    void captureException(error, { area: 'nftscan' });
    return null;
  }
}

export async function getNFTCollection(params: {
  contractAddress: string;
  chain: string;
}): Promise<{
  contractAddress: string;
  name: string;
  symbol: string;
  contractType: string;
  ownerCount: number;
  totalSupply: number;
  totalVolume: string;
  floorPrice: string;
  floorPriceSymbol: string;
  logo: string;
  description: string;
  website: string;
  twitter: string;
  discord: string;
  telegram: string;
  isVerified: boolean;
} | null> {
  const chain = getChain(params.chain);
  const response = await fetchNFTScan<NFTScanCollectionResponse>(
    `/api/v2/collection/${params.contractAddress}?chain=${chain}`
  );

  if (!response || !response.data) {
    return null;
  }

  const data = response.data;
  return {
    contractAddress: data.contract_address,
    name: data.name,
    symbol: data.symbol,
    contractType: data.contract_type,
    ownerCount: data.owner_count,
    totalSupply: data.total_supply,
    totalVolume: data.total_volume,
    floorPrice: data.floor_price,
    floorPriceSymbol: data.floor_price_symbol,
    logo: data.logo,
    description: data.description,
    website: data.website,
    twitter: data.twitter,
    discord: data.discord,
    telegram: data.telegram,
    isVerified: data.is_verified,
  };
}

export async function getNFTTrades(params: {
  contractAddress: string;
  chain: string;
  limit?: number;
}): Promise<Array<{
  transactionHash: string;
  transactionType: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  amountUsd: string;
  price: string;
  priceUsd: string;
  tokenId: string;
  blockNumber: number;
  blockTimestamp: number;
  tradeTime: number;
}> | null> {
  const chain = getChain(params.chain);
  const limit = params.limit ?? 10;
  const response = await fetchNFTScan<NFTScanTradesResponse>(
    `/api/v2/collection/${params.contractAddress}/trades?chain=${chain}&limit=${limit}`
  );

  if (!response || !response.data || response.data.length === 0) {
    return null;
  }

  return response.data.map(trade => ({
    transactionHash: trade.transaction_hash,
    transactionType: trade.transaction_type,
    fromAddress: trade.from_address,
    toAddress: trade.to_address,
    amount: trade.amount,
    amountUsd: trade.amount_usd,
    price: trade.price,
    priceUsd: trade.price_usd,
    tokenId: trade.token_id,
    blockNumber: trade.block_number,
    blockTimestamp: trade.block_timestamp,
    tradeTime: trade.trade_time,
  }));
}

export async function getNFTOwners(params: {
  contractAddress: string;
  chain: string;
  limit?: number;
}): Promise<Array<{
  owner: string;
  tokenAmount: number;
}> | null> {
  const chain = getChain(params.chain);
  const limit = params.limit ?? 100;
  const response = await fetchNFTScan<NFTScanOwnersResponse>(
    `/api/v2/collection/${params.contractAddress}/owners?chain=${chain}&limit=${limit}`
  );

  if (!response || !response.data || response.data.length === 0) {
    return null;
  }

  return response.data.map(owner => ({
    owner: owner.owner,
    tokenAmount: owner.token_amount,
  }));
}

export async function getNFTStatistics(params: {
  contractAddress: string;
  chain: string;
}): Promise<{
  totalVolume: string;
  totalVolumeUsd: string;
  totalTradeCount: number;
  totalHolderCount: number;
  oneDayVolume: string;
  oneDayVolumeUsd: string;
  oneDayTradeCount: number;
  sevenDayVolume: string;
  sevenDayVolumeUsd: string;
  sevenDayTradeCount: number;
  thirtyDayVolume: string;
  thirtyDayVolumeUsd: string;
  thirtyDayTradeCount: number;
} | null> {
  const chain = getChain(params.chain);
  const response = await fetchNFTScan<NFTScanStatisticsResponse>(
    `/api/v2/collection/${params.contractAddress}/statistics?chain=${chain}`
  );

  if (!response || !response.data) {
    return null;
  }

  const data = response.data;
  return {
    totalVolume: data.total_volume,
    totalVolumeUsd: data.total_volume_usd,
    totalTradeCount: data.total_trade_count,
    totalHolderCount: data.total_holder_count,
    oneDayVolume: data.one_day_volume,
    oneDayVolumeUsd: data.one_day_volume_usd,
    oneDayTradeCount: data.one_day_trade_count,
    sevenDayVolume: data.seven_day_volume,
    sevenDayVolumeUsd: data.seven_day_volume_usd,
    sevenDayTradeCount: data.seven_day_trade_count,
    thirtyDayVolume: data.thirty_day_volume,
    thirtyDayVolumeUsd: data.thirty_day_volume_usd,
    thirtyDayTradeCount: data.thirty_day_trade_count,
  };
}
