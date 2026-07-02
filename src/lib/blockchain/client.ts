import { createPublicClient, fallback, http, type PublicClient } from 'viem';
import { getChain } from '@/lib/blockchain/chains';

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

// Fix #10: cap public client cache (one per chain — typically 4 entries max)
const MAX_PUBLIC_CLIENTS = 10;
const publicClients = new Map<string, PublicClient>();

// _userId is accepted for backward compatibility (callers pass it for RPC routing context)
// but is unused since Viem's fallback() handles provider selection automatically.
export function getClient(chain: string, _userId?: string): PublicClient {
  const key = chain.toLowerCase();
  if (!publicClients.has(key)) {
    publicClients.set(key, createPublicClient({
      chain: getChain(key),
      transport: buildTransport(key),
    }));
  }
  return publicClients.get(key)!;
}



