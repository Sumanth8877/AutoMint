import { getPublicClient, getRpcHealthSnapshot } from '@/lib/services/rpc-manager.service';
import type { ChainKey } from './chains';

export function getPrimaryClient(chain: ChainKey) {
  return getPublicClient(chain);
}

export async function getClient(chain: ChainKey) {
  return getPublicClient(chain);
}

export async function isRpcHealthy(chain: ChainKey): Promise<boolean> {
  void chain;
  const health = await getRpcHealthSnapshot();
  return !health.alchemy.unhealthyUntil || health.alchemy.unhealthyUntil <= Date.now();
}
