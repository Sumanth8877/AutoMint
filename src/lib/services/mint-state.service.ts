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
import { type Hex, parseAbi } from 'viem';
import { addBreadcrumb } from '@/lib/observability/sentry';

// ─── Types ──────────────────────────────────────────────────────────────────

export type MintStatus = 'LIVE' | 'NOT_STARTED' | 'ENDED' | 'UNKNOWN';

export interface MintState {
  status: MintStatus;
  startTime?: Date;
  endTime?: Date;
  maxSupply?: number;
  minted?: number;
}

// ─── ABI (parsed once at module load, reused across calls) ──────────────────
//
// parseAbi is called once — not per getMintState invocation — because the
// result is a stable module-level constant. No per-call overhead.

const MULTICALL_ABI = parseAbi([
  'function publicMintActive() view returns (bool)',
  'function maxSupply() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function mintStart() view returns (uint256)',
  'function mintEnd() view returns (uint256)',
  'function paused() view returns (bool)',
]);

// ─── OpenSea enrichment (optional) ──────────────────────────────────────────

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

    // AbortSignal.timeout() covers the network round-trip only — not the body
    // parse. A response with a huge JSON body can still block the event loop
    // after the headers arrive. Race the body parse against a 5s timeout so
    // a runaway OpenSea response can't stall the mint execution pipeline.
    const json = await Promise.race<unknown>([
      res.json(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OpenSea JSON parse timeout')), 5_000),
      ),
    ]);
    const j = json as { collection?: { stats?: Record<string, unknown>; created_at?: string }; stats?: Record<string, unknown> } | undefined;
    const stats = j?.collection?.stats ?? j?.stats;
    if (!stats) return undefined;

    return {
      maxSupply: stats.max_supply ? Number(stats.max_supply) : undefined,
      totalMinted: stats.total_supply ? Number(stats.total_supply) : undefined,
      startTime: (j?.collection?.created_at ?? (stats as Record<string, unknown>).created_at) as string | undefined,
      endTime: undefined,
    };
  } catch {
    return undefined;
  }
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export async function getMintState(contractAddress: string, chain: string): Promise<MintState> {
  if (!contractAddress || !chain) {
    return { status: 'UNKNOWN' };
  }

  const client = getClient(chain);

  // Batch all 6 state reads into a single eth_call via Multicall3.
  //
  // Previously: 6 concurrent readContract calls (Promise.all) = 6 JSON-RPC
  // requests flying to the provider simultaneously. Each still occupies a
  // separate RPC rate-limit unit and a separate network slot.
  //
  // Now: 1 multicall = 1 JSON-RPC request to the Multicall3 contract on-chain.
  // The EVM aggregates all reads in a single execution context.
  //
  // Impact during monitoring: getMintState fires on every new block for the
  // entire watch window (up to 25s × ~1 block/2s on Base = ~12 calls).
  // Reducing from 6 RPC calls to 1 per check cuts RPC consumption by ~83%.
  //
  // allowFailure: true mirrors the old callView() behaviour — a function that
  // reverts (e.g. the contract doesn't implement maxSupply) returns a failure
  // status instead of throwing the whole batch.
  const FALLBACK = Array(6).fill({ status: 'failure' as const });

  const results = await client.multicall({
    contracts: [
      { address: contractAddress as Hex, abi: MULTICALL_ABI, functionName: 'publicMintActive' },
      { address: contractAddress as Hex, abi: MULTICALL_ABI, functionName: 'maxSupply' },
      { address: contractAddress as Hex, abi: MULTICALL_ABI, functionName: 'totalSupply' },
      { address: contractAddress as Hex, abi: MULTICALL_ABI, functionName: 'mintStart' },
      { address: contractAddress as Hex, abi: MULTICALL_ABI, functionName: 'mintEnd' },
      { address: contractAddress as Hex, abi: MULTICALL_ABI, functionName: 'paused' },
    ],
    allowFailure: true,
  }).catch(() => FALLBACK);

  const [
    publicMintActiveRes,
    maxSupplyRes,
    totalSupplyRes,
    mintStartRes,
    mintEndRes,
    pausedRes,
  ] = results;

  // Unwrap each result — undefined on failure, same as the old callView()
  const publicMintActive = publicMintActiveRes.status === 'success'
    ? publicMintActiveRes.result as boolean : undefined;
  const maxSupplyRaw = maxSupplyRes.status === 'success'
    ? maxSupplyRes.result as bigint : undefined;
  const totalSupplyRaw = totalSupplyRes.status === 'success'
    ? totalSupplyRes.result as bigint : undefined;
  const mintStartRaw = mintStartRes.status === 'success'
    ? mintStartRes.result as bigint : undefined;
  const mintEndRaw = mintEndRes.status === 'success'
    ? mintEndRes.result as bigint : undefined;
  const paused = pausedRes.status === 'success'
    ? pausedRes.result as boolean : undefined;

  const maxSupply    = typeof maxSupplyRaw    === 'bigint' ? Number(maxSupplyRaw)    : undefined;
  const totalMinted  = typeof totalSupplyRaw  === 'bigint' ? Number(totalSupplyRaw)  : undefined;
  const startTime    = typeof mintStartRaw    === 'bigint' ? new Date(Number(mintStartRaw) * 1000) : undefined;
  const endTime      = typeof mintEndRaw      === 'bigint' ? new Date(Number(mintEndRaw)   * 1000) : undefined;

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
      const osMax    = osMeta.maxSupply    ?? maxSupply;
      const osMinted = osMeta.totalMinted  ?? totalMinted;
      const osEnd    = osMeta.endTime   ? new Date(osMeta.endTime)   : endTime;
      const osStart  = osMeta.startTime ? new Date(osMeta.startTime) : startTime;

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
