import { getRpcHealthSnapshot } from '@/lib/services/rpc-manager.service';
import type { ChainKey } from './chains';

/**
 * Returns true if at least one RPC provider has no open circuit breaker.
 *
 * Health is tracked globally per-provider; the chain parameter is accepted for
 * API consistency and future per-chain health tracking.
 *
 * Previously this file exported getPrimaryClient / getClient (both identical
 * wrappers around getPublicClient) and only checked Alchemy health while
 * ignoring the chain argument. Simplified to its only meaningful function.
 *
 * For public client access use: import { getClient } from '@/lib/blockchain/client'
 */
export async function isRpcHealthy(_chain: ChainKey): Promise<boolean> {
  const health = await getRpcHealthSnapshot();
  const now = Date.now();
  // Healthy if at least one provider has no open circuit breaker
  return Object.values(health).some(
    (h) => !h.unhealthyUntil || h.unhealthyUntil <= now,
  );
}
