import 'server-only';

import { createHash, createPrivateKey, createPublicKey, createECDH } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';
import { decodeBase58OrThrow, encodeBase58 } from './base58';

export type ImportWalletType = 'EVM' | 'SOLANA' | 'BITCOIN';

type DerivedWallet = {
  address: string;
  privateKey: string;
  walletType: ImportWalletType;
};

const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// A BIP-39 seed phrase is 12/15/18/21/24 space-separated words. We treat any
// input matching that shape as a seed phrase rather than a raw private key,
// so the same "Private Key" field can accept either.
const MNEMONIC_WORD_COUNTS = [12, 15, 18, 21, 24];

function looksLikeMnemonic(value: string): boolean {
  const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return MNEMONIC_WORD_COUNTS.includes(words.length);
}

// Standard EVM derivation path (same one MetaMask/most wallets use for the
// first account): m/44'/60'/0'/0/0.
function evmPrivateKeyFromMnemonic(mnemonic: string): `0x${string}` {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!validateMnemonic(normalized, englishWordlist)) {
    throw new Error('Invalid seed phrase (expected 12/15/18/21/24 valid BIP-39 words)');
  }
  const seed = mnemonicToSeedSync(normalized);
  const hdKey = HDKey.fromMasterSeed(seed).derive("m/44'/60'/0'/0/0");
  if (!hdKey.privateKey) throw new Error('Failed to derive private key from seed phrase');
  return `0x${Buffer.from(hdKey.privateKey).toString('hex')}` as `0x${string}`;
}

function normalizeHexPrivateKey(value: string) {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (!/^[a-f0-9]{64}$/i.test(withoutPrefix)) throw new Error('Invalid private key format');
  return `0x${withoutPrefix.toLowerCase()}` as `0x${string}`;
}

function parseSolanaSecretKey(value: string) {
  const trimmed = value.trim();
  let bytes: Buffer;

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      throw new Error('Invalid Solana private key');
    }
    bytes = Buffer.from(parsed);
  } else if (/^[a-f0-9]{64}$/i.test(trimmed) || /^[a-f0-9]{128}$/i.test(trimmed)) {
    bytes = Buffer.from(trimmed, 'hex');
  } else {
    bytes = Buffer.from(decodeBase58OrThrow(trimmed));
  }

  if (bytes.length !== 32 && bytes.length !== 64) throw new Error('Invalid Solana private key');
  return bytes;
}

function deriveSolanaWallet(privateKey: string): DerivedWallet {
  try {
    const secret = parseSolanaSecretKey(privateKey);
    const seed = secret.subarray(0, 32);
    const keyObject = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    });
    // @types/node@26 omits the KeyObject overload for createPublicKey; cast via unknown to satisfy stricter types.
    // Node.js crypto accepts KeyObject directly at runtime — this is a types-only workaround.
    const publicDer = createPublicKey(keyObject as unknown as Parameters<typeof createPublicKey>[0]).export({ format: 'der', type: 'spki' });
    const publicKey = Buffer.from(publicDer).subarray(-32);

    if (secret.length === 64 && !secret.subarray(32).equals(publicKey)) {
      throw new Error('Invalid Solana private key');
    }

    return {
      address: encodeBase58(publicKey),
      privateKey: encodeBase58(secret),
      walletType: 'SOLANA',
    };
  } catch {
    throw new Error('Invalid Solana private key');
  }
}

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest();
}

function hash160(bytes: Buffer) {
  const sha = sha256(bytes);
  return createHash('ripemd160').update(sha).digest();
}

function decodeBase58Check(value: string) {
  const decoded = decodeBase58OrThrow(value);
  if (decoded.length < 5) throw new Error('Invalid Bitcoin private key');
  const payload = decoded.subarray(0, -4);
  const checksum = decoded.subarray(-4);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!checksum.equals(expected)) throw new Error('Invalid Bitcoin private key');
  return payload;
}

function bech32Polymod(values: number[]) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;

  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < generators.length; index += 1) {
      if ((top >> index) & 1) checksum ^= generators[index];
    }
  }

  return checksum;
}

function bech32HrpExpand(hrp: string) {
  const result: number[] = [];
  for (const char of hrp) result.push(char.charCodeAt(0) >> 5);
  result.push(0);
  for (const char of hrp) result.push(char.charCodeAt(0) & 31);
  return result;
}

function bech32CreateChecksum(hrp: string, data: number[]) {
  const values = [...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0];
  const polymod = bech32Polymod(values) ^ 1;
  return Array.from({ length: 6 }, (_, index) => (polymod >> (5 * (5 - index))) & 31);
}

function convertBits(bytes: Buffer, fromBits: number, toBits: number, pad: boolean) {
  let accumulator = 0;
  let bits = 0;
  const maxValue = (1 << toBits) - 1;
  const result: number[] = [];

  for (const byte of bytes) {
    accumulator = (accumulator << fromBits) | byte;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }

  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & maxValue);
  return result;
}

function encodeBech32(hrp: string, data: number[]) {
  const combined = [...data, ...bech32CreateChecksum(hrp, data)];
  return `${hrp}1${combined.map((value) => BECH32_ALPHABET[value]).join('')}`;
}

function parseBitcoinPrivateKey(value: string) {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return { privateKey: Buffer.from(trimmed, 'hex'), compressed: true };
  }

  const payload = decodeBase58Check(trimmed);
  if (payload[0] !== 0x80) throw new Error('Invalid Bitcoin private key');
  if (payload.length === 34 && payload[33] === 0x01) {
    return { privateKey: payload.subarray(1, 33), compressed: true };
  }
  if (payload.length === 33) {
    return { privateKey: payload.subarray(1), compressed: false };
  }
  throw new Error('Invalid Bitcoin private key');
}

function deriveBitcoinWallet(privateKey: string): DerivedWallet {
  try {
    const parsed = parseBitcoinPrivateKey(privateKey);
    const ecdh = createECDH('secp256k1');
    ecdh.setPrivateKey(parsed.privateKey);
    const publicKey = ecdh.getPublicKey(undefined, parsed.compressed ? 'compressed' : 'uncompressed');
    const witnessProgram = hash160(Buffer.from(publicKey));
    const address = encodeBech32('bc', [0, ...convertBits(witnessProgram, 8, 5, true)]);

    return {
      address,
      privateKey: privateKey.trim(),
      walletType: 'BITCOIN',
    };
  } catch {
    throw new Error('Invalid Bitcoin private key');
  }
}

function deriveEvmWallet(privateKey: string): DerivedWallet {
  try {
    const normalized = looksLikeMnemonic(privateKey)
      ? evmPrivateKeyFromMnemonic(privateKey)
      : normalizeHexPrivateKey(privateKey);
    const account = privateKeyToAccount(normalized);
    return {
      address: account.address.toLowerCase(),
      privateKey: normalized,
      walletType: 'EVM',
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('seed phrase')) throw error;
    throw new Error('Invalid EVM private key or seed phrase');
  }
}

export function deriveWalletFromPrivateKey(walletType: ImportWalletType, privateKey: string): DerivedWallet {
  if (!privateKey.trim()) throw new Error('Private key or seed phrase is required');
  if (walletType === 'EVM') return deriveEvmWallet(privateKey);
  if (walletType === 'SOLANA') {
    if (looksLikeMnemonic(privateKey)) {
      throw new Error('Seed phrase import is only supported for EVM wallets right now — paste a Solana private key instead');
    }
    return deriveSolanaWallet(privateKey);
  }
  if (looksLikeMnemonic(privateKey)) {
    throw new Error('Seed phrase import is only supported for EVM wallets right now — paste a Bitcoin private key instead');
  }
  return deriveBitcoinWallet(privateKey);
}