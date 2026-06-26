import { getClient } from './client';
import { captureException } from '@/lib/observability/sentry';

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
