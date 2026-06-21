import { getPublicClient, getRpcHealthSnapshot } from '@/lib/services/rpc-manager.service';
import type { ChainKey } from './chains';

export function getPrimaryClient(chain: ChainKey, userId?: string) {
  return getPublicClient(chain, { userId });
}

export async function getClient(chain: ChainKey, userId?: string) {
  return getPublicClient(chain, { userId });
}

export async function isRpcHealthy(chain: ChainKey): Promise<boolean> {
  void chain;
  const health = await getRpcHealthSnapshot();
  return !health.alchemy.unhealthyUntil || health.alchemy.unhealthyUntil <= Date.now();
}
