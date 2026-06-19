import { getClient } from './client';

export interface GasEstimate {
  gasPrice: string;
  estimatedFee: string;
  symbol: string;
}

export async function estimateGas(chain: string): Promise<GasEstimate> {
  try {
    const client = getClient(chain);
    const gasPrice = await client.getGasPrice();
    const symbol = chain === 'polygon' ? 'POL' : 'ETH';
    const estimatedFee = gasPrice * BigInt(21000); // Standard transfer gas limit

    return {
      gasPrice: gasPrice.toString(),
      estimatedFee: estimatedFee.toString(),
      symbol,
    };
  } catch (error) {
    console.error(`Error estimating gas for ${chain}:`, error);
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