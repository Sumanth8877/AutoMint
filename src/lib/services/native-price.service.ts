import 'server-only';

import { cacheWithTTL } from '@/lib/redis';

/**
 * native-price.service.ts
 *
 * Fetches the USD price of a chain's native token (ETH / POL) so amounts can be
 * shown to the user in both crypto and fiat. Knowing the dollar value makes it
 * obvious how much to fund a wallet with — "0.004 ETH" means little, but
 * "0.004 ETH (~$10.50)" is immediately actionable.
 *
 * Source: CoinGecko simple-price API (free, no key). Cached in Redis for 5 min
 * so a burst of mints doesn't hammer the endpoint. Falls back to a sane constant
 * when the API is unavailable, so price display never blocks the mint pipeline.
 */

// CoinGecko coin ids per chain native token. Base/Arbitrum settle in ETH.
const COINGECKO_IDS: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'ethereum',
  arbitrum: 'ethereum',
  polygon: 'matic-network',
};

// Fallback prices used only when CoinGecko is unreachable.
const FALLBACK_USD: Record<string, number> = {
  ethereum: 2500,
  base: 2500,
  arbitrum: 2500,
  polygon: 0.5,
};

const PRICE_TTL_SECONDS = 300; // 5 minutes

/**
 * Current USD price of the chain's native token. Returns a number (live or
 * cached), or the fallback constant — never null — so callers can always format
 * a USD value.
 */
export async function getNativeTokenUsdPrice(chain: string): Promise<number> {
  const chainKey = chain.toLowerCase();
  const coinId = COINGECKO_IDS[chainKey] ?? 'ethereum';

  return cacheWithTTL(
    `native-usd:${coinId}`,
    async () => {
      try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
        const res = await fetch(url, { signal: AbortSignal.timeout(4_000) });
        if (!res.ok) return FALLBACK_USD[chainKey] ?? 2500;
        const json = (await res.json()) as Record<string, { usd?: number }>;
        const price = json?.[coinId]?.usd;
        return typeof price === 'number' && price > 0 ? price : (FALLBACK_USD[chainKey] ?? 2500);
      } catch {
        return FALLBACK_USD[chainKey] ?? 2500;
      }
    },
    PRICE_TTL_SECONDS,
  );
}

/** Format a USD amount as "$1.23" / "$2,450.00" / "<$0.01". */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd)) return '';
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format a native-token amount with its USD equivalent, e.g.
 *   "0.004 ETH (~$10.50)".
 * `symbol` is the wallet's balance symbol (ETH / POL). Pass the live USD price
 * from getNativeTokenUsdPrice(). Trims trailing zeros for readability.
 */
export function formatWithUsd(amountEth: number | string, symbol: string, usdPrice: number): string {
  const amount = typeof amountEth === 'string' ? Number(amountEth) : amountEth;
  if (!Number.isFinite(amount)) return `${amountEth} ${symbol}`;
  // Show up to 6 significant decimals, trimming trailing zeros.
  const ethStr = amount.toFixed(6).replace(/\.?0+$/, '') || '0';
  const usd = amount * usdPrice;
  const usdStr = formatUsd(usd);
  return usdStr ? `${ethStr} ${symbol} (~${usdStr})` : `${ethStr} ${symbol}`;
}
