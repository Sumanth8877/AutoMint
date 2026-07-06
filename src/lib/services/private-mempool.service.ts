import 'server-only';

// ─── Private Mempool Endpoints ────────────────────────────────────────────────
//
// These endpoints accept signed transactions via eth_sendRawTransaction but route
// them through a private channel, bypassing the public mempool. This prevents:
//   - Frontrunning (bots copying your tx with higher gas)
//   - Sandwich attacks (buy-before, sell-after your trade)
//   - MEV extraction (arbitrage bots exploiting your tx ordering)
//
// Flashbots Protect (default):
//   - FREE, no API key needed
//   - Transactions only land if included in a block (no gas wasted on failures)
//   - Supported chains: Ethereum mainnet only
//   - Docs: https://docs.flashbots.net/flashbots-protect/overview
//
// MEV Blocker:
//   - FREE, no API key needed
//   - Routes to multiple builders, maximizes inclusion probability
//   - Supported chains: Ethereum mainnet only
//   - Docs: https://mevblocker.io
//
// Flashbots Fast:
//   - Skips simulation — faster inclusion but less protection
//   - Use when speed is more important than full sandwich protection

const PRIVATE_ENDPOINTS: Record<string, string[]> = {
  ethereum: [
    'https://rpc.flashbots.net',          // Flashbots Protect (default)
    'https://rpc.mevblocker.io',          // MEV Blocker (fallback)
    'https://rpc.flashbots.net/fast',     // Flashbots Fast (last resort)
  ],
  // Base, Polygon, and Arbitrum do not have widely available private mempool
  // endpoints. Transactions fall back to the standard public broadcast path.
  // Fix #2: Arbitrum was previously absent entirely (relying on the `?? []`
  // fallback at the lookup site below) — now explicit so it's clear this is
  // an intentional "no private mempool for this chain" decision, not a gap.
  base: [],
  polygon: [],
  arbitrum: [],
};

export interface PrivateBroadcastResult {
  txHash: `0x${string}`;
  endpoint: string;
  isPrivate: boolean;
}

/**
 * Broadcast a signed transaction via private mempool endpoints.
 *
 * Tries each configured private endpoint in order. Falls back gracefully to
 * the public broadcast path if all private endpoints fail or if the chain
 * does not support private mempools (Base, Polygon).
 *
 * @param chain      - Chain name ('ethereum', 'base', 'polygon')
 * @param signedTx   - ABI-encoded signed transaction bytes (0x-prefixed)
 * @returns          - txHash + which endpoint accepted it + whether it was private
 */
export async function broadcastViaPrivateMempool(
  chain: string,
  signedTx: `0x${string}`,
): Promise<PrivateBroadcastResult> {
  const endpoints = PRIVATE_ENDPOINTS[chain.toLowerCase()] ?? [];

  if (endpoints.length === 0) {
    // Chain does not support private mempools — broadcast publicly
    return broadcastPublicFallback(chain, signedTx);
  }

  // Try each private endpoint in order (not parallel — avoids sending to Flashbots
  // AND MEV Blocker simultaneously, which can cause double-inclusion edge cases)
  for (const endpoint of endpoints) {
    try {
      const txHash = await sendToPrivateEndpoint(endpoint, signedTx);

      return { txHash, endpoint, isPrivate: true };
    } catch (error) {
      // Try the next endpoint
    }
  }

  // All private endpoints failed — fall back to public broadcast

  return broadcastPublicFallback(chain, signedTx);
}

/**
 * Send a raw transaction to a private endpoint via JSON-RPC.
 * Returns the txHash on success, throws on failure.
 */
async function sendToPrivateEndpoint(
  endpoint: string,
  signedTx: `0x${string}`,
): Promise<`0x${string}`> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendRawTransaction',
      params: [signedTx],
    }),
    signal: AbortSignal.timeout(15_000), // 15s timeout per endpoint
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${endpoint}`);
  }

  const json = await response.json() as {
    result?: string;
    error?: { message: string; code: number };
  };

  if (json.error) {
    throw new Error(`RPC error from ${endpoint}: ${json.error.message} (code ${json.error.code})`);
  }

  if (!json.result || typeof json.result !== 'string') {
    throw new Error(`No txHash returned from ${endpoint}`);
  }

  return json.result as `0x${string}`;
}

/**
 * Public broadcast fallback — uses the existing RPC manager broadcast path.
 */
async function broadcastPublicFallback(
  chain: string,
  signedTx: `0x${string}`,
): Promise<PrivateBroadcastResult> {
  const { broadcastRawTransaction } = await import('@/lib/services/rpc-manager.service');
  const txHash = await broadcastRawTransaction(chain, signedTx);
  return { txHash, endpoint: 'public', isPrivate: false };
}

/**
 * Check whether a chain supports private mempool broadcasting.
 */
export function supportsPrivateMempool(chain: string): boolean {
  const endpoints = PRIVATE_ENDPOINTS[chain.toLowerCase()] ?? [];
  return endpoints.length > 0;
}
