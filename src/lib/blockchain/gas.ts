import { getClient } from './client';
import { captureException } from '@/lib/observability/sentry';
import type { Address, Hex } from 'viem';

export type GasStrategy = 'STANDARD' | 'FAST' | 'AGGRESSIVE';

export interface Eip1559GasParams {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

const STRATEGY_MULTIPLIERS: Record<GasStrategy, { base: bigint; priority: bigint }> = {
  STANDARD: { base: 200n, priority: 100n },
  FAST: { base: 225n, priority: 125n },
  AGGRESSIVE: { base: 300n, priority: 150n },
};

function scale(value: bigint, percent: bigint): bigint {
  return (value * percent) / 100n;
}

function average(values: bigint[]): bigint {
  if (values.length === 0) return 0n;
  return values.reduce((sum, value) => sum + value, 0n) / BigInt(values.length);
}

function latestBaseFee(baseFeePerGas: bigint[]): bigint {
  return baseFeePerGas.at(-1) ?? 0n;
}

function averagePriorityFee(reward: bigint[][] | undefined): bigint {
  if (!reward?.length) return 1_500_000_000n;

  const firstPercentileRewards = reward
    .map((blockRewards) => blockRewards[0])
    .filter((value): value is bigint => typeof value === 'bigint' && value > 0n);

  return average(firstPercentileRewards) || 1_500_000_000n;
}

export async function getEip1559GasParams(
  chain: string,
  strategy: GasStrategy = 'STANDARD',
): Promise<Eip1559GasParams> {
  const client = getClient(chain);
  const multiplier = STRATEGY_MULTIPLIERS[strategy] ?? STRATEGY_MULTIPLIERS.STANDARD;

  try {
    const feeHistory = await client.getFeeHistory({
      blockCount: 5,
      rewardPercentiles: [50],
    });

    const baseFee = latestBaseFee(feeHistory.baseFeePerGas);
    const priorityFee = scale(averagePriorityFee(feeHistory.reward), multiplier.priority);

    return {
      maxFeePerGas: scale(baseFee, multiplier.base) + priorityFee,
      maxPriorityFeePerGas: priorityFee,
    };
  } catch (error) {
    await captureException(error, {
      area: 'gas',
      context: { chain, strategy },
      fingerprint: ['gas', 'fee-history-error'],
    });

    const gasPrice = await client.getGasPrice();
    const priorityFee = scale(gasPrice / 10n, multiplier.priority);
    return {
      maxFeePerGas: scale(gasPrice, multiplier.base),
      maxPriorityFeePerGas: priorityFee > 0n ? priorityFee : 1n,
    };
  }
}

export async function getGasLimit(
  chain: string,
  from: Address,
  to: Address,
  data: Hex = '0x',
  value: bigint = 0n,
): Promise<bigint> {
  const client = getClient(chain);
  return client.estimateGas({ account: from, to, data, value });
}

export interface GasEstimate {
  gasPrice: string;          // maxFeePerGas (EIP-1559) or gasPrice (legacy)
  baseFee?: string;          // EIP-1559 base fee in wei (burned, not paid to validator)
  maxPriorityFee?: string;   // EIP-1559 priority fee in wei (tip to validator)
  estimatedFee: string;      // gasPrice * 21 000 in wei
  symbol: string;
}

export async function estimateGas(chain: string): Promise<GasEstimate> {
  try {
    const client = getClient(chain);
    const symbol = chain === 'polygon' ? 'POL' : 'ETH';
    const GAS_LIMIT = 21_000n; // standard transfer — mint gas is higher, but consistent for UI

    // ── EIP-1559 path (ETH mainnet, Base) ──────────────────────────────────
    // getBlock('pending') returns baseFeePerGas when the chain supports EIP-1559.
    // estimateMaxPriorityFeePerGas() samples recent blocks for the validator tip.
    // Together they give a baseFee + priorityFee breakdown the UI can display.
    try {
      const [block, priorityFee] = await Promise.all([
        client.getBlock({ blockTag: 'pending' }),
        client.estimateMaxPriorityFeePerGas(),
      ]);

      if (block.baseFeePerGas) {
        const baseFee = block.baseFeePerGas;
        // maxFeePerGas mirrors the strategy used by resolveGasParams() in mint.ts:
        // baseFee * 2 gives a two-block buffer; priorityFee is the validator tip.
        const maxFee = baseFee * 2n + priorityFee;
        return {
          gasPrice: maxFee.toString(),
          baseFee: baseFee.toString(),
          maxPriorityFee: priorityFee.toString(),
          estimatedFee: (maxFee * GAS_LIMIT).toString(),
          symbol,
        };
      }
    } catch {
      // Chain doesn't support EIP-1559 (e.g. Polygon PoS legacy mode)
      // or the pending block isn't available — fall through to legacy path.
      // This is expected behaviour, not an error — no Sentry capture needed.
    }

    // ── Legacy fallback (Polygon PoS, or any non-EIP-1559 chain) ───────────
    const gasPrice = await client.getGasPrice();
    return {
      gasPrice: gasPrice.toString(),
      estimatedFee: (gasPrice * GAS_LIMIT).toString(),
      symbol,
    };
  } catch (error) {
    await captureException(error, {
      area: 'gas',
      context: { chain },
      fingerprint: ['gas', 'estimate-error'],
    });
    return {
      gasPrice: '0',
      estimatedFee: '0',
      symbol: chain === 'polygon' ? 'POL' : 'ETH',
    };
  }
}

export function formatGasPrice(wei: string, decimals = 9): string {
  const value = BigInt(wei);
  if (value === BigInt(0)) return '0';
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = value / divisor;
  const remainder = value % divisor;
  return `${whole.toString()}.${remainder.toString().padStart(Number(decimals), '0').slice(0, 4)}`;
}

export function formatFee(wei: string): string {
  const value = BigInt(wei);
  const eth = Number(value) / 1e18;
  if (eth < 0.001) return '< 0.001';
  return eth.toFixed(4);
}
