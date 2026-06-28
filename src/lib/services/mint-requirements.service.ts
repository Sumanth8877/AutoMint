import { getClient } from '@/lib/blockchain/client';
import type { Hex } from 'viem';
import { discoverContractABI } from '@/lib/services/mint-abi-discovery.service';
import { planMintFunction } from '@/lib/services/mint-calldata.service';
import { getSeaDropPublicDrop, SEADROP_MINT_FUNCTION } from '@/lib/services/seadrop.service';

const CONTRACT_ABI = ['function maxPerWallet() view returns (uint256)', 'function maxPerTx() view returns (uint256)', 'function mintStart() view returns (uint256)', 'function mintEnd() view returns (uint256)'] as const;

// Collections expose the mint price under many different getter names. We probe
// them all and take the first that resolves. A returned value of 0n is a VALID
// free mint. If NONE resolve, the price has no on-chain getter (e.g. OpenSea /
// SeaDrop drops keep price in per-stage config) and mintPrice is reported as
// null — "unknown", which callers must NOT coerce to 0. A wrong 0 sends a
// 0-value mint that reverts and gets misreported as a honeypot.
const PRICE_ABI = ['function publicMintPrice() view returns (uint256)', 'function mintPrice() view returns (uint256)', 'function price() view returns (uint256)', 'function cost() view returns (uint256)', 'function salePrice() view returns (uint256)', 'function publicSalePrice() view returns (uint256)', 'function publicPrice() view returns (uint256)', 'function getPrice() view returns (uint256)', 'function mintFee() view returns (uint256)', 'function tokenPrice() view returns (uint256)'] as const;
const PRICE_GETTERS = ['publicMintPrice', 'mintPrice', 'price', 'cost', 'salePrice', 'publicSalePrice', 'publicPrice', 'getPrice', 'mintFee', 'tokenPrice'] as const;
type PriceGetter = typeof PRICE_GETTERS[number];

// mintPrice is `string | null`: a decimal ETH string when known ('0.000000' is a
// valid free mint), or null when the price could not be read on-chain.
export interface MintRequirements { mintFunction: string; mintPrice: string | null; maxPerWallet?: number; maxPerTx?: number; mintStartTime?: Date; mintEndTime?: Date; isSoldOut?: boolean; }

type RequirementFunction = 'maxPerWallet' | 'maxPerTx' | 'mintStart' | 'mintEnd';

async function callView(client: ReturnType<typeof getClient>, address: string, fn: RequirementFunction): Promise<bigint | undefined> { try { return await client.readContract({ address: address as Hex, abi: CONTRACT_ABI, functionName: fn }) as bigint; } catch { return undefined; } }

/**
 * Probe every known price getter in parallel and return the first uint256 found
 * (0n is a valid free-mint price). Returns undefined when none of them resolve,
 * meaning the price is genuinely not readable on-chain.
 */
async function readMintPriceWei(client: ReturnType<typeof getClient>, address: string): Promise<bigint | undefined> {
  const results = await Promise.all(
    PRICE_GETTERS.map(async (fn: PriceGetter) => {
      try { return await client.readContract({ address: address as Hex, abi: PRICE_ABI, functionName: fn }) as bigint; } catch { return undefined; }
    }),
  );
  return results.find((v): v is bigint => typeof v === 'bigint');
}

/**
 * Fetch mint requirements AND discover the correct mint function name in parallel.
 *
 * Speed fix: ABI discovery previously happened at execution time (inside executeMint),
 * adding 300-600ms to the hot path. Now it runs concurrently with the contract
 * view calls during task creation, so zero latency is added to execution.
 *
 * The discovered mintFunction is stored in the DB task record and passed directly
 * to executeMint via params.mintFunction — no discovery needed at execution time.
 */
export async function fetchMintRequirements(contractAddress: string, chain: string): Promise<MintRequirements> {
  const client = getClient(chain);

  // Run ABI discovery, contract view reads, and SeaDrop detection in parallel —
  // all independent. SeaDrop is one extra eth_call, so it adds no latency.
  const [
    priceWei, maxPerWallet, maxPerTx, mintStart, mintEnd,
    abiResult, seaDrop,
  ] = await Promise.all([
    readMintPriceWei(client, contractAddress),
    callView(client, contractAddress, 'maxPerWallet'),
    callView(client, contractAddress, 'maxPerTx'),
    callView(client, contractAddress, 'mintStart'),
    callView(client, contractAddress, 'mintEnd'),
    // Speed fix: discover the mint function name now so it's stored in the DB.
    // At execution time, params.mintFunction will already be set — no ABI lookup needed.
    discoverContractABI(contractAddress, chain).catch(() => null),
    // OpenSea drops are SeaDrop contracts: price lives in PublicDrop config and
    // the mint must be routed through SeaDrop, not a token-level mint().
    getSeaDropPublicDrop(contractAddress, chain).catch(() => null),
  ]);

  // null (not '0') when the price has no on-chain getter — callers fall back to
  // off-chain discovery and block rather than minting with a wrong 0 value.
  let mintPrice = typeof priceWei === 'bigint' ? (Number(priceWei) / 1e18).toFixed(6) : null;

  // Resolve the real mint function from the ABI. planMintFunction returns either
  // a full re-parseable signature (generic encoding) or an 'unsupported:<name>'
  // sentinel when the mechanism needs data we can't synthesise (proofs, ids, …).
  let mintFunction = 'mint';
  if (abiResult && abiResult.abi.length > 0) {
    const plan = planMintFunction(abiResult.abi);
    if (plan) mintFunction = plan.mintFunction;
  }

  // SeaDrop drop: authoritative on-chain price + correct mint route. This is the
  // path that makes pasting an OpenSea collection URL actually mintable.
  if (seaDrop && mintPrice == null) {
    mintPrice = seaDrop.mintPriceEth;
    mintFunction = SEADROP_MINT_FUNCTION;
  }

  return {
    mintFunction,
    mintPrice,
    maxPerWallet: seaDrop?.maxPerWallet ?? (typeof maxPerWallet === 'bigint' ? Number(maxPerWallet) : undefined),
    maxPerTx: typeof maxPerTx === 'bigint' ? Number(maxPerTx) : undefined,
    mintStartTime: seaDrop?.startTime ?? (typeof mintStart === 'bigint' ? new Date(Number(mintStart) * 1000) : undefined),
    mintEndTime: seaDrop?.endTime ?? (typeof mintEnd === 'bigint' ? new Date(Number(mintEnd) * 1000) : undefined),
  };
}
