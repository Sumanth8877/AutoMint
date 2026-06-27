import { createPublicClient, createWalletClient, fallback, http, type Account, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getChain } from '@/lib/blockchain/chains';
import type { Hex } from 'viem';

// ── RPC URL helpers ──────────────────────────────────────────────────────────

function alchemyUrl(chainName: string): string | undefined {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return undefined;
  if (chainName === 'base')      return `https://base-mainnet.g.alchemy.com/v2/${key}`;
  if (chainName === 'polygon')   return `https://polygon-mainnet.g.alchemy.com/v2/${key}`;
  if (chainName === 'arbitrum')  return `https://arb-mainnet.g.alchemy.com/v2/${key}`;
  return `https://eth-mainnet.g.alchemy.com/v2/${key}`;
}

function infuraUrl(chainName: string): string | undefined {
  const key = process.env.INFURA_API_KEY;
  if (!key) return undefined;
  if (chainName === 'base')      return `https://base-mainnet.infura.io/v3/${key}`;
  if (chainName === 'polygon')   return `https://polygon-mainnet.infura.io/v3/${key}`;
  if (chainName === 'arbitrum')  return `https://arbitrum-mainnet.infura.io/v3/${key}`;
  return `https://mainnet.infura.io/v3/${key}`;
}

function chainstackUrl(chainName: string): string | undefined {
  const key = process.env.CHAINSTACK_API_KEY;
  if (!key) return process.env.CHAINSTACK_RPC_URL ?? undefined;
  if (chainName === 'base')      return `https://base-mainnet.core.chainstack.com/${key}`;
  if (chainName === 'polygon')   return `https://polygon-mainnet.core.chainstack.com/${key}`;
  if (chainName === 'arbitrum')  return `https://arbitrum-mainnet.core.chainstack.com/${key}`;
  return `https://ethereum-mainnet.core.chainstack.com/${key}`;
}

/**
 * Build a Viem fallback transport from all configured RPC providers.
 *
 * Uses viem's built-in `fallback()` transport which automatically:
 *   - Tries the next provider on error / timeout (no custom retry loop needed)
 *   - Ranks providers by latency when `rank: true` (adaptive, per-session)
 *
 * Replaces the old manual withRpcFallback() loop for public client creation.
 * Providers with no API key configured are silently skipped.
 */
function buildTransport(chainName: string) {
  const urls = [
    alchemyUrl(chainName),
    infuraUrl(chainName),
    chainstackUrl(chainName),
    process.env.ALCHEMY_RPC_URL,
    process.env.INFURA_RPC_URL,
    process.env.CHAINSTACK_RPC_URL,
  ].filter((u): u is string => Boolean(u));

  // Deduplicate (e.g. CHAINSTACK_RPC_URL and derived key URL may overlap)
  const unique = [...new Set(urls)];
  if (unique.length === 0) throw new Error(`No RPC URLs configured for chain: ${chainName}`);

  // rank: false — fixed priority order (Alchemy first, then Infura, then Chainstack)
  // rank: true  — adaptive latency ranking (good for prod, but adds warm-up latency on first calls)
  return fallback(unique.map(u => http(u)), { rank: false });
}

// ── Client cache (singleton per chain) ──────────────────────────────────────

const publicClients = new Map<string, PublicClient>();
const walletClients = new Map<string, WalletClient>();

export function getClient(chain: string): PublicClient {
  const key = chain.toLowerCase();
  if (!publicClients.has(key)) {
    publicClients.set(key, createPublicClient({
      chain: getChain(key),
      transport: buildTransport(key),
    }));
  }
  return publicClients.get(key)!;
}

export function getWalletClient(chain: string, accountOrKey: Account | string): WalletClient {
  const account: Account = typeof accountOrKey === 'string'
    ? getAccountFromPrivateKey(accountOrKey)
    : accountOrKey;
  const key = `${chain.toLowerCase()}:${account.address}`;
  if (!walletClients.has(key)) {
    walletClients.set(key, createWalletClient({
      chain: getChain(chain.toLowerCase()),
      transport: buildTransport(chain.toLowerCase()),
      account,
    }));
  }
  return walletClients.get(key)!;
}

export function getAccountFromPrivateKey(privateKey: string): Account {
  const hex = privateKey.startsWith('0x') ? privateKey as Hex : `0x${privateKey}` as Hex;
  return privateKeyToAccount(hex);
}
