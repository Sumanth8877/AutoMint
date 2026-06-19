import { createPublicClient, http } from 'viem';
import { mainnet, base, polygon } from 'viem/chains';

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';

const alchemyUrl = (chainId: number) => {
  const baseUrl = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
  switch (chainId) {
    case 1: return `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
    case 8453: return `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
    case 137: return `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
    default: return baseUrl;
  }
};

export const publicClients = {
  ethereum: createPublicClient({
    chain: mainnet,
    transport: http(alchemyUrl(1)),
  }),
  base: createPublicClient({
    chain: base,
    transport: http(alchemyUrl(8453)),
  }),
  polygon: createPublicClient({
    chain: polygon,
    transport: http(alchemyUrl(137)),
  }),
};

export function getClient(chain: string) {
  const client = publicClients[chain as keyof typeof publicClients];
  if (!client) throw new Error(`Unsupported chain: ${chain}`);
  return client;
}