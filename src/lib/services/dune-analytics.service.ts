import 'server-only';

type DuneExecutionResponse = {
  execution_id: string;
  state: 'QUERY_STATE_PENDING' | 'QUERY_STATE_RUNNING' | 'QUERY_STATE_SUCCEEDED' | 'QUERY_STATE_FAILED' | 'QUERY_STATE_CANCELLED';
};

type DuneResultResponse = {
  result: {
    rows: Record<string, unknown>[];
    metadata: {
      column_names: string[];
      column_types: string[];
    };
  };
};

type DuneQueryResult = {
  rows: Record<string, unknown>[];
  columnNames: string[];
};

type DuneNFTMetrics = {
  totalMints: number | null;
  totalTrades: number | null;
  totalVolume: string | null;
  uniqueTraders: number | null;
  avgSalePrice: string | null;
  recentMints24h: number | null;
  recentTrades24h: number | null;
  recentVolume24h: string | null;
};

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function formatCurrency(value: unknown, decimals = 4): string | null {
  const num = numericValue(value);
  if (num === null || num <= 0) return null;
  return num.toFixed(num >= 10 ? 2 : decimals);
}

async function executeDuneSQL(sql: string): Promise<DuneQueryResult | null> {
  const apiKey = process.env.DUNE_API_KEY;
  if (!apiKey) {
    console.warn('Dune API key not found, skipping query');
    return null;
  }

  try {
    // Execute SQL query
    const executeResponse = await fetch('https://api.dune.com/api/v1/query/execute', {
      method: 'POST',
      headers: {
        'X-Dune-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query_sql: sql,
        performance: 'medium',
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!executeResponse.ok) {
      console.error(`Dune execute failed with status ${executeResponse.status}`);
      return null;
    }

    const executeData: DuneExecutionResponse = await executeResponse.json();
    
    if (executeData.state === 'QUERY_STATE_FAILED' || executeData.state === 'QUERY_STATE_CANCELLED') {
      console.error(`Dune query failed with state ${executeData.state}`);
      return null;
    }

    // Poll for results
    const maxAttempts = 10;
    const pollInterval = 2_000;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const statusResponse = await fetch(`https://api.dune.com/api/v1/execution/${executeData.execution_id}/status`, {
        headers: {
          'X-Dune-API-Key': apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!statusResponse.ok) {
        console.error(`Dune status check failed with status ${statusResponse.status}`);
        continue;
      }

      const statusData: DuneExecutionResponse = await statusResponse.json();

      if (statusData.state === 'QUERY_STATE_SUCCEEDED') {
        // Fetch results
        const resultResponse = await fetch(`https://api.dune.com/api/v1/execution/${executeData.execution_id}/results`, {
          headers: {
            'X-Dune-API-Key': apiKey,
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!resultResponse.ok) {
          console.error(`Dune results fetch failed with status ${resultResponse.status}`);
          return null;
        }

        const resultData: DuneResultResponse = await resultResponse.json();
        
        return {
          rows: resultData.result.rows,
          columnNames: resultData.result.metadata.column_names,
        };
      }

      if (statusData.state === 'QUERY_STATE_FAILED' || statusData.state === 'QUERY_STATE_CANCELLED') {
        console.error(`Dune query failed with state ${statusData.state}`);
        return null;
      }

      // Still running, continue polling
    }

    console.error('Dune query timed out');
    return null;
  } catch (error) {
    console.error('Dune query execution failed:', error);
    return null;
  }
}

export async function fetchNFTCollectionMetrics(params: {
  contractAddress: string;
  chain: string;
}): Promise<DuneNFTMetrics | null> {
  // Map chain names to Dune blockchain identifiers
  const chainMap: Record<string, string> = {
    ethereum: 'ethereum',
    base: 'base',
    polygon: 'polygon',
    bsc: 'bsc',
    arbitrum: 'arbitrum',
    optimism: 'optimism',
    avalanche: 'avalanche',
    fantom: 'fantom',
  };

  const duneChain = chainMap[params.chain.toLowerCase()] || params.chain.toLowerCase();
  const contractLower = params.contractAddress.toLowerCase();

  // Query Dune's curated nft.trades table directly
  const sql = `
    SELECT
      COUNT(*) as total_trades,
      SUM(amount) as total_volume,
      COUNT(DISTINCT trader) as unique_traders,
      AVG(amount) as avg_sale_price,
      COUNT(CASE WHEN block_time >= NOW() - INTERVAL '24 hours' THEN 1 END) as recent_trades_24h,
      SUM(CASE WHEN block_time >= NOW() - INTERVAL '24 hours' THEN amount ELSE 0 END) as recent_volume_24h
    FROM nft.trades
    WHERE nft_contract_address = '${contractLower}'
      AND blockchain = '${duneChain}'
    LIMIT 1
  `;

  const result = await executeDuneSQL(sql);

  if (!result || result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    totalMints: null, // nft.trades doesn't have mint data
    totalTrades: numericValue(row.total_trades),
    totalVolume: formatCurrency(row.total_volume),
    uniqueTraders: numericValue(row.unique_traders),
    avgSalePrice: formatCurrency(row.avg_sale_price),
    recentMints24h: null,
    recentTrades24h: numericValue(row.recent_trades_24h),
    recentVolume24h: formatCurrency(row.recent_volume_24h),
  };
}

export async function fetchNFTRecentActivity(params: {
  contractAddress: string;
  chain: string;
  limit?: number;
}): Promise<Array<{
  type: 'mint' | 'sale';
  timestamp: string;
  price: string | null;
  from: string | null;
  to: string | null;
}> | null> {
  const chainMap: Record<string, string> = {
    ethereum: 'ethereum',
    base: 'base',
    polygon: 'polygon',
    bsc: 'bsc',
    arbitrum: 'arbitrum',
    optimism: 'optimism',
    avalanche: 'avalanche',
    fantom: 'fantom',
  };

  const duneChain = chainMap[params.chain.toLowerCase()] || params.chain.toLowerCase();
  const contractLower = params.contractAddress.toLowerCase();
  const limit = params.limit ?? 10;

  const sql = `
    SELECT
      'sale' as type,
      block_time as timestamp,
      amount as price,
      trader as from_addr,
      nft_from_address as to_addr
    FROM nft.trades
    WHERE nft_contract_address = '${contractLower}'
      AND blockchain = '${duneChain}'
    ORDER BY block_time DESC
    LIMIT ${limit}
  `;

  const result = await executeDuneSQL(sql);

  if (!result || result.rows.length === 0) {
    return null;
  }

  return result.rows.map(row => ({
    type: 'sale',
    timestamp: stringValue(row.timestamp) || new Date().toISOString(),
    price: formatCurrency(row.price),
    from: stringValue(row.from_addr),
    to: stringValue(row.to_addr),
  }));
}

export async function fetchTokenPrice(params: {
  tokenAddress: string;
  chain: string;
}): Promise<{
  price: string | null;
  priceChange24h: string | null;
  marketCap: string | null;
  volume24h: string | null;
} | null> {
  const chainMap: Record<string, string> = {
    ethereum: 'ethereum',
    base: 'base',
    polygon: 'polygon',
    bsc: 'bsc',
    arbitrum: 'arbitrum',
    optimism: 'optimism',
    avalanche: 'avalanche',
  };

  const duneChain = chainMap[params.chain.toLowerCase()] || params.chain.toLowerCase();
  const tokenLower = params.tokenAddress.toLowerCase();

  const sql = `
    SELECT
      price,
      price_24h_change_percent as price_change_24h,
      market_cap,
      volume_24h
    FROM prices.usd
    WHERE token_address = '${tokenLower}'
      AND blockchain = '${duneChain}'
    ORDER BY minute DESC
    LIMIT 1
  `;

  const result = await executeDuneSQL(sql);

  if (!result || result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    price: formatCurrency(row.price),
    priceChange24h: formatCurrency(row.price_change_24h),
    marketCap: formatCurrency(row.market_cap),
    volume24h: formatCurrency(row.volume_24h),
  };
}
