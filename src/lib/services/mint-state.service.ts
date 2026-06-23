/**
 * getMintState(contractAddress, chain)
 *
 * Determine the current mint state of an NFT contract:
 *   LIVE | NOT_STARTED | ENDED | UNKNOWN
 *
 * Uses on-chain RPC calls (Viem) as primary source.
 * Optionally enriches via OpenSea API if available.
 * Stateless + idempotent. Redis caching recommended for production.
 *
 * Does NOT execute any transactions.
 */

import { getClient } from '@/lib/blockchain/client';
import type { Hex } from 'viem';

// ─── Types ─────────────────────────────────────────

export type MintStatus = 'LIVE' | 'NOT_STARTED' | 'ENDED' | 'UNKNOWN';

export interface MintState {
  status: MintStatus;
  startTime?: Date;
  endTime?: Date;
  maxSupply?: number;
  minted?: number;
}

// ─── ABI fragments ────────────────────────────────

const STATE_ABI = [
  'function publicMintActive() view returns (bool)',
  'function maxSupply() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function mintStart() view returns (uint256)',
  'function mintEnd() view returns (uint256)',
  'function paused() view returns (bool)',
] as const;

type StateFunction = 'publicMintActive' | 'maxSupply' | 'totalSupply' | 'mintStart' | 'mintEnd' | 'paused';

// ─── Helpers ──────────────────────────────────────

async function callView(
  client: ReturnType<typeof getClient>,
  address: string,
  functionName: StateFunction,
): Promise<bigint | boolean | undefined> {
  try {
    return await client.readContract({
      address: address as Hex,
      abi: STATE_ABI,
      functionName,
    }) as bigint | boolean | undefined;
  } catch {
    return undefined;
  }
}

// ─── OpenSea enrichment (optional) ────────────────

interface OpenSeaMintMeta {
  maxSupply?: number;
  totalMinted?: number;
  startTime?: string;
  endTime?: string;
}

async function fetchOpenSeaMintMeta(contractAddress: string): Promise<OpenSeaMintMeta | undefined> {
  try {
    const apiKey = process.env.OPENSEA_API_KEY;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['X-API-KEY'] = apiKey;

    const url = `https://api.opensea.io/v2/chain/ethereum/contract/${contractAddress}/nfts`;

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(3_000),
    });

    if (!res.ok) return undefined;
    const json = await res.json();
    const stats = json?.collection?.stats ?? json?.stats;
    if (!stats) return undefined;

    return {
      maxSupply: stats.max_supply ? Number(stats.max_supply) : undefined,
      totalMinted: stats.total_supply ? Number(stats.total_supply) : undefined,
      startTime: json?.collection?.created_at ?? stats.created_at,
      endTime: undefined,
    };
  } catch {
    return undefined;
  }
}

// ─── Main resolver ─────────────────────────────────

export async function getMintState(contractAddress: string, chain: string): Promise<MintState> {
  if (!contractAddress || !chain) {
    return { status: 'UNKNOWN' };
  }

  const client = getClient(chain);

  const [publicMintActive, maxSupplyRaw, totalSupplyRaw, mintStartRaw, mintEndRaw, paused] = await Promise.all([
    callView(client, contractAddress, 'publicMintActive'),
    callView(client, contractAddress, 'maxSupply'),
    callView(client, contractAddress, 'totalSupply'),
    callView(client, contractAddress, 'mintStart'),
    callView(client, contractAddress, 'mintEnd'),
    callView(client, contractAddress, 'paused'),
  ]);

  const maxSupply = typeof maxSupplyRaw === 'bigint' ? Number(maxSupplyRaw) : undefined;
  const totalMinted = typeof totalSupplyRaw === 'bigint' ? Number(totalSupplyRaw) : undefined;
  const startTime = typeof mintStartRaw === 'bigint' ? new Date(Number(mintStartRaw) * 1000) : undefined;
  const endTime = typeof mintEndRaw === 'bigint' ? new Date(Number(mintEndRaw) * 1000) : undefined;

  const now = Date.now();

  if (typeof publicMintActive === 'boolean') {
    if (!publicMintActive) {
      if (endTime && now >= endTime.getTime()) {
        return { status: 'ENDED', startTime, endTime, maxSupply, minted: totalMinted };
      }
      if (startTime && now < startTime.getTime()) {
        return { status: 'NOT_STARTED', startTime, endTime, maxSupply, minted: totalMinted };
      }
      return { status: 'NOT_STARTED', startTime, endTime, maxSupply, minted: totalMinted };
    }

    if (endTime && now >= endTime.getTime()) {
      return { status: 'ENDED', startTime, endTime, maxSupply, minted: totalMinted };
    }
    return { status: 'LIVE', startTime, endTime, maxSupply, minted: totalMinted };
  }

  if (paused === true) {
    return { status: 'NOT_STARTED', startTime, endTime, maxSupply, minted: totalMinted };
  }

  if (maxSupply !== undefined && totalMinted !== undefined) {
    if (totalMinted >= maxSupply) {
      return { status: 'ENDED', startTime, endTime, maxSupply, minted: totalMinted };
    }
    if (endTime && now >= endTime.getTime()) {
      return { status: 'ENDED', startTime, endTime, maxSupply, minted: totalMinted };
    }
    if (startTime && now < startTime.getTime()) {
      return { status: 'NOT_STARTED', startTime, endTime, maxSupply, minted: totalMinted };
    }
    return { status: 'LIVE', startTime, endTime, maxSupply, minted: totalMinted };
  }

  if (chain === 'ethereum') {
    // M-9 fix: warn clearly when OPENSEA_API_KEY is not set.
    // Unauthenticated OpenSea calls are rate-limited to ~5 req/min.
    // During an active mint window getMintState is called frequently from the
    // orchestrator, risk engine, QStash handler, and copy-mint service.
    // Without an API key those calls get 429'd and osMeta returns undefined,
    // causing the function to fall through to UNKNOWN — missing live mints.
    // Set OPENSEA_API_KEY in your environment to avoid this.
    if (!process.env.OPENSEA_API_KEY) {
      addBreadcrumb({ category: 'mint-state', message: 'OPENSEA_API_KEY not configured — skipping OpenSea state check', level: 'warning' });
      return { status: 'UNKNOWN', startTime, endTime, maxSupply, minted: totalMinted };
    }

    const osMeta = await fetchOpenSeaMintMeta(contractAddress);
    if (osMeta) {
      const osMax = osMeta.maxSupply ?? maxSupply;
      const osMinted = osMeta.totalMinted ?? totalMinted;
      const osEnd = osMeta.endTime ? new Date(osMeta.endTime) : endTime;
      const osStart = osMeta.startTime ? new Date(osMeta.startTime) : startTime;

      if (osEnd && now >= osEnd.getTime()) {
        return { status: 'ENDED', startTime: osStart, endTime: osEnd, maxSupply: osMax, minted: osMinted };
      }
      if (osStart && now < osStart.getTime()) {
        return { status: 'NOT_STARTED', startTime: osStart, endTime: osEnd, maxSupply: osMax, minted: osMinted };
      }
      if (osMinted !== undefined && osMax !== undefined && osMinted >= osMax) {
        return { status: 'ENDED', startTime: osStart, endTime: osEnd, maxSupply: osMax, minted: osMinted };
      }
      return { status: 'LIVE', startTime: osStart, endTime: osEnd, maxSupply: osMax, minted: osMinted };
    }
  }

  return { status: 'UNKNOWN', startTime, endTime, maxSupply, minted: totalMinted };
}
