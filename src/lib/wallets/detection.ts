import { isAddress } from 'viem';
import { decodeBase58 } from './base58';

export const WALLET_TYPES = ['EVM', 'SOLANA', 'BITCOIN', 'UNKNOWN'] as const;

export type WalletType = (typeof WALLET_TYPES)[number];

type WalletDetector = {
  type: WalletType;
  matches: (address: string) => boolean;
};

const BITCOIN_ADDRESS_PATTERN = /^(bc1[ac-hj-np-z02-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

function isSolanaAddress(address: string) {
  if (address.length < 32 || address.length > 44) return false;
  const decoded = decodeBase58(address);
  return decoded?.length === 32;
}

function isBitcoinAddress(address: string) {
  return BITCOIN_ADDRESS_PATTERN.test(address);
}

const DETECTORS: WalletDetector[] = [
  { type: 'EVM', matches: (address) => isAddress(address) },
  { type: 'SOLANA', matches: isSolanaAddress },
  { type: 'BITCOIN', matches: isBitcoinAddress },
];

export function detectWalletType(address: string): WalletType {
  const trimmed = address.trim();
  return DETECTORS.find((detector) => detector.matches(trimmed))?.type ?? 'UNKNOWN';
}

export function normalizeWalletAddress(address: string, walletType = detectWalletType(address)) {
  const trimmed = address.trim();
  return walletType === 'EVM' ? trimmed.toLowerCase() : trimmed;
}

export function isWalletType(value: unknown): value is WalletType {
  return typeof value === 'string' && WALLET_TYPES.includes(value as WalletType);
}

export function assertValidWalletAddress(address: string, walletTypeOverride?: WalletType) {
  const walletType = detectWalletType(address);
  const resolvedType = walletTypeOverride && walletTypeOverride !== 'UNKNOWN' ? walletTypeOverride : walletType;

  if (resolvedType === 'UNKNOWN') {
    throw new Error('Wallet type could not be detected. Enter a valid EVM, Solana, or Bitcoin address.');
  }

  return {
    walletType: resolvedType,
    address: normalizeWalletAddress(address, resolvedType),
  };
}
