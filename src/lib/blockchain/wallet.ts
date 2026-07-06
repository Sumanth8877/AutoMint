import { formatEther, multicall3Abi } from 'viem';
import { getClient } from './client';
import { CHAIN_NATIVE_TOKENS } from './chains';

export async function getWalletBalance(address: string, chain: string) {
  try {
    const client = getClient(chain);
    const balance = await client.getBalance({ address: address as `0x${string}` });
    const formatted = formatEther(balance);
    const symbol = CHAIN_NATIVE_TOKENS[chain as keyof typeof CHAIN_NATIVE_TOKENS] || 'ETH';
    return { balance: formatted, symbol };
  } catch (error) {
    return { balance: '0', symbol: CHAIN_NATIVE_TOKENS[chain as keyof typeof CHAIN_NATIVE_TOKENS] || 'ETH' };
  }
}

// ── Batch balance lookups (viem multicall) ──────────────────────────────
//
// Native-token balance checks don't hit a contract, so they can't be
// "batched" via a normal multi-call the way ERC-20 reads can — UNLESS you
// route them through Multicall3's own getEthBalance(address) function,
// which is exactly what this does. All chains this app supports (mainnet,
// base, polygon, arbitrum) have Multicall3 deployed at the same address and
// viem's chain definitions already know about it, so client.multicall()
// picks it up with zero extra config.
//
// Use this instead of calling getWalletBalance() in a loop/Promise.all
// whenever you need N wallets' balances at once (e.g. a fanout mint across
// many wallets) — it's 1 RPC round-trip instead of N, which matters both for
// latency (checking 20 wallets serially/individually can take longer than
// the mint window) and for metered RPC cost (Alchemy bills per request).
//
// allowFailure: true means one bad address (RPC hiccup, invalid checksum)
// returns a per-address error instead of failing the whole batch.
export interface WalletBalanceResult {
  address: string;
  balance: string; // formatted ETH-units string, '0' on failure
  symbol: string;
  error?: string;
}

export async function getWalletBalancesMulticall(
  addresses: string[],
  chain: string,
): Promise<WalletBalanceResult[]> {
  const symbol = CHAIN_NATIVE_TOKENS[chain as keyof typeof CHAIN_NATIVE_TOKENS] || 'ETH';
  if (addresses.length === 0) return [];

  try {
    const client = getClient(chain);
    const multicallAddress = client.chain?.contracts?.multicall3?.address;
    if (!multicallAddress) throw new Error(`Multicall3 not configured for chain: ${chain}`);

    const results = await client.multicall({
      contracts: addresses.map((address) => ({
        address: multicallAddress,
        abi: multicall3Abi,
        functionName: 'getEthBalance',
        args: [address as `0x${string}`],
      })),
      allowFailure: true,
    });

    return addresses.map((address, index) => {
      const result = results[index];
      if (result.status === 'success') {
        return { address, balance: formatEther(result.result as bigint), symbol };
      }
      return { address, balance: '0', symbol, error: result.error?.message ?? 'Balance lookup failed' };
    });
  } catch (error) {
    // Fail closed per-address rather than throwing — callers (e.g. fanout)
    // should treat a lookup failure the same as "insufficient balance
    // unknown, be conservative" rather than aborting the whole batch.
    return addresses.map((address) => ({
      address,
      balance: '0',
      symbol,
      error: error instanceof Error ? error.message : 'Balance lookup failed',
    }));
  }
}

export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}