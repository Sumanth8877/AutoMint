import { formatEther } from 'viem';
import { getClient } from './client';
import { CHAIN_NATIVE_TOKENS } from './chains';
import { captureException } from '@/lib/observability/sentry';

export async function getWalletBalance(address: string, chain: string) {
  try {
    const client = getClient(chain);
    const balance = await client.getBalance({ address: address as `0x${string}` });
    const formatted = formatEther(balance);
    const symbol = CHAIN_NATIVE_TOKENS[chain as keyof typeof CHAIN_NATIVE_TOKENS] || 'ETH';
    return { balance: formatted, symbol };
  } catch (error) {
    captureException(error, { area: 'wallet', context: { address, chain }, fingerprint: ['wallet', 'balance-error'] });
    return { balance: '0', symbol: CHAIN_NATIVE_TOKENS[chain as keyof typeof CHAIN_NATIVE_TOKENS] || 'ETH' };
  }
}

export function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}