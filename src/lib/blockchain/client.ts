import 'server-only';

import { createPublicClient, http } from 'viem';
import type { PublicClient } from 'viem';
import { mainnet, base, polygon } from 'viem/chains';

type SupportedChain = 'ethereum' | 'base' | 'polygon';

const clients: Partial<Record<SupportedChain, PublicClient>> = {};

const alchemyUrl = (chainId: number) => {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) return undefined;

  const baseUrl = `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
  switch (chainId) {
    case 1: return `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
    case 8453: return `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;
    case 137: return `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`;
    default: return baseUrl;
  }
};

const clientConfig = {
  ethereum: { chain: mainnet, chainId: 1 },
  base: { chain: base, chainId: 8453 },
  polygon: { chain: polygon, chainId: 137 },
};

export function getClient(chain: string): PublicClient {
  if (!isSupportedChain(chain)) throw new Error(`Unsupported chain: ${chain}`);

  const existing = clients[chain];
  if (existing) return existing;

  const client = createPublicClient({
    chain: clientConfig[chain].chain,
    transport: http(alchemyUrl(clientConfig[chain].chainId)),
  });

  clients[chain] = client;
  return client;
}

function isSupportedChain(chain: string): chain is SupportedChain {
  return chain in clientConfig;
}
