import { isAddress } from 'viem';

export const WALLET_TYPES = ['EVM', 'SOLANA', 'BITCOIN', 'UNKNOWN'] as const;

export type WalletType = (typeof WALLET_TYPES)[number];

type WalletDetector = {
  type: WalletType;
  matches: (address: string) => boolean;
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BITCOIN_ADDRESS_PATTERN = /^(bc1[ac-hj-np-z02-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

function decodeBase58(value: string) {
  if (!value) return null;

  const bytes = [0];

  for (const char of value) {
    const carryStart = BASE58_ALPHABET.indexOf(char);
    if (carryStart === -1) return null;

    let carry = carryStart;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of value) {
    if (char !== '1') break;
    bytes.push(0);
  }

  return Uint8Array.from(bytes.reverse());
}

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

function isPotentialUnknownWalletAddress(address: string) {
  return /^[A-Za-z0-9:_-]{16,128}$/.test(address);
}

export function isWalletType(value: unknown): value is WalletType {
  return typeof value === 'string' && WALLET_TYPES.includes(value as WalletType);
}

export function assertValidWalletAddress(address: string, walletTypeOverride?: WalletType) {
  const walletType = detectWalletType(address);
  const resolvedType = walletType === 'UNKNOWN' && walletTypeOverride === 'UNKNOWN' ? 'UNKNOWN' : walletType;

  if (resolvedType === 'UNKNOWN' && !isPotentialUnknownWalletAddress(address.trim())) {
    throw new Error('Invalid wallet address format');
  }
  if (walletType === 'UNKNOWN' && !walletTypeOverride) {
    throw new Error('Wallet type could not be detected. Choose Unknown to store this address.');
  }

  return {
    walletType: resolvedType,
    address: normalizeWalletAddress(address, resolvedType),
  };
}
