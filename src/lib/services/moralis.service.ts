import 'server-only';

type MoralisNFTCollectionResponse = {
  result: {
    token_address: string;
    name: string;
    symbol: string;
    contract_type: string;
    synced_at: string;
  }[];
};

type MoralisNFTTradesResponse = {
  result: {
    transaction_hash: string;
    transaction_index: string;
    log_index: string;
    from_address: string;
    to_address: string;
    value: string;
    value_str: string;
    token_address: string;
    token_id: string;
    block_number: string;
    block_timestamp: string;
  }[];
};

type MoralisTokenPriceResponse = {
  result: {
    tokenName: string;
    tokenSymbol: string;
    tokenLogo: string;
    tokenDecimals: string;
    nativePrice: {
      value: string;
      decimals: number;
      name: string;
      symbol: string;
    };
    usdPrice: number;
    usdPriceFormatted: string;
    exchangeAddress: string;
    exchangeName: string;
    '24hrPercentChange': string;
  }[];
};

type MoralisWalletNFTsResponse = {
  result: {
    token_address: string;
    token_id: string;
    owner_of: string;
    block_number: string;
    block_number_minted: string;
    token_uri: string;
    metadata: string;
    last_token_uri_sync: string;
    last_metadata_sync: string;
    possible_spam: boolean;
    verified_collection: boolean;
  }[];
};

const CHAIN_MAP: Record<string, string> = {
  ethereum: '0x1',
  base: '0x2105',
  polygon: '0x89',
  bsc: '0x38',
  arbitrum: '0xa4b1',
  optimism: '0xa',
  avalanche: '0xa86a',
  fantom: '0xfa',
};

function getChainId(chain: string): string {
  return CHAIN_MAP[chain.toLowerCase()] || chain;
}

async function fetchMoralis<T>(endpoint: string): Promise<T | null> {
  const apiKey = process.env.MORALIS_API_KEY;
  if (!apiKey) {
    console.warn('Moralis API key not found, skipping request');
    return null;
  }

  try {
    const response = await fetch(`https://api.moralis.io${endpoint}`, {
      headers: {
        'Accept': 'application/json',
        'X-API-Key': apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      console.error(`Moralis API failed with status ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Moralis API request failed:', error);
    return null;
  }
}

export async function getNFTCollection(params: {
  contractAddress: string;
  chain: string;
}): Promise<{
  tokenAddress: string;
  name: string;
  symbol: string;
  contractType: string;
} | null> {
  const chainId = getChainId(params.chain);
  const response = await fetchMoralis<MoralisNFTCollectionResponse>(
    `/api/v2.2/nft/${params.contractAddress}/metadata?chain=${chainId}`
  );

  if (!response || !response.result || response.result.length === 0) {
    return null;
  }

  const collection = response.result[0];
  return {
    tokenAddress: collection.token_address,
    name: collection.name,
    symbol: collection.symbol,
    contractType: collection.contract_type,
  };
}

export async function getNFTTrades(params: {
  contractAddress: string;
  chain: string;
  limit?: number;
}): Promise<Array<{
  transactionHash: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  blockTimestamp: string;
}> | null> {
  const chainId = getChainId(params.chain);
  const limit = params.limit ?? 10;
  const response = await fetchMoralis<MoralisNFTTradesResponse>(
    `/api/v2.2/nft/${params.contractAddress}/trades?chain=${chainId}&limit=${limit}`
  );

  if (!response || !response.result || response.result.length === 0) {
    return null;
  }

  return response.result.map(trade => ({
    transactionHash: trade.transaction_hash,
    fromAddress: trade.from_address,
    toAddress: trade.to_address,
    value: trade.value,
    blockTimestamp: trade.block_timestamp,
  }));
}

export async function getTokenPrice(params: {
  tokenAddress: string;
  chain: string;
}): Promise<{
  tokenName: string;
  tokenSymbol: string;
  usdPrice: number;
  usdPriceFormatted: string;
  exchangeName: string;
  percentChange24h: string;
} | null> {
  const chainId = getChainId(params.chain);
  const response = await fetchMoralis<MoralisTokenPriceResponse>(
    `/api/v2.2/erc20/${params.tokenAddress}/price?chain=${chainId}&include=percent_change`
  );

  if (!response || !response.result || response.result.length === 0) {
    return null;
  }

  const price = response.result[0];
  return {
    tokenName: price.tokenName,
    tokenSymbol: price.tokenSymbol,
    usdPrice: price.usdPrice,
    usdPriceFormatted: price.usdPriceFormatted,
    exchangeName: price.exchangeName,
    percentChange24h: price['24hrPercentChange'],
  };
}

export async function getWalletNFTs(params: {
  address: string;
  chain: string;
  limit?: number;
}): Promise<Array<{
  tokenAddress: string;
  tokenId: string;
  ownerOf: string;
  metadata: string;
  possibleSpam: boolean;
  verifiedCollection: boolean;
}> | null> {
  const chainId = getChainId(params.chain);
  const limit = params.limit ?? 100;
  const response = await fetchMoralis<MoralisWalletNFTsResponse>(
    `/api/v2.2/${params.address}/nft?chain=${chainId}&limit=${limit}&format=decimal`
  );

  if (!response || !response.result || response.result.length === 0) {
    return null;
  }

  return response.result.map(nft => ({
    tokenAddress: nft.token_address,
    tokenId: nft.token_id,
    ownerOf: nft.owner_of,
    metadata: nft.metadata,
    possibleSpam: nft.possible_spam,
    verifiedCollection: nft.verified_collection,
  }));
}

export async function getWalletTokenBalances(params: {
  address: string;
  chain: string;
}): Promise<Array<{
  tokenAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  balance: string;
  possibleSpam: boolean;
}> | null> {
  const chainId = getChainId(params.chain);
  const response = await fetchMoralis<{ result: Array<{
    token_address: string;
    name: string;
    symbol: string;
    decimals: string;
    balance: string;
    possible_spam: boolean;
  }> }>(
    `/api/v2.2/${params.address}/erc20?chain=${chainId}`
  );

  if (!response || !response.result || response.result.length === 0) {
    return null;
  }

  return response.result.map(token => ({
    tokenAddress: token.token_address,
    name: token.name,
    symbol: token.symbol,
    decimals: parseInt(token.decimals, 10),
    balance: token.balance,
    possibleSpam: token.possible_spam,
  }));
}
