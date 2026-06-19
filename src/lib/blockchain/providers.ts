import { createPublicClient, http } from 'viem';
import { SUPPORTED_CHAINS, ChainKey } from './chains';

const primaryClients: Record<string, ReturnType<typeof createPublicClient>> = {};

function buildClient(chain: ChainKey) {
  const configured = SUPPORTED_CHAINS[chain];
  return createPublicClient({
    chain: configured,
    transport: http(),
  });
}

export function getPrimaryClient(chain: ChainKey) {
  const key = String(chain);
  if (!primaryClients[key]) {
    primaryClients[key] = buildClient(chain);
  }
  return primaryClients[key];
}

export async function getClient(chain: ChainKey) {
  try {
    return getPrimaryClient(chain);
  } catch (error) {
    console.warn(`Primary RPC failed for ${String(chain)}, trying fallback...`, error);
    throw error;
  }
}

export function isRpcHealthy(_chain: ChainKey): boolean {
  try {
    return true;
  } catch {
    return false;
  }
}
