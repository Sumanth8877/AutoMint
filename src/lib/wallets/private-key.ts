import 'server-only';

import { createHash, createPrivateKey, createPublicKey, createECDH } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';

export type ImportWalletType = 'EVM' | 'SOLANA' | 'BITCOIN';

type DerivedWallet = {
  address: string;
  privateKey: string;
  walletType: ImportWalletType;
};

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32_ALPHABET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function normalizeHexPrivateKey(value: string) {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (!/^[a-f0-9]{64}$/i.test(withoutPrefix)) throw new Error('Invalid private key format');
  return `0x${withoutPrefix.toLowerCase()}` as `0x${string}`;
}

function decodeBase58(value: string) {
  if (!value) throw new Error('Invalid private key format');

  const bytes = [0];

  for (const char of value) {
    const carryStart = BASE58_ALPHABET.indexOf(char);
    if (carryStart === -1) throw new Error('Invalid private key format');

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

  return Buffer.from(bytes.reverse());
}

function encodeBase58(bytes: Buffer) {
  if (bytes.length === 0) return '';

  const digits = [0];

  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let encoded = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded += '1';
  }

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    encoded += BASE58_ALPHABET[digits[index]];
  }

  return encoded;
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
    bytes = decodeBase58(trimmed);
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
  const decoded = decodeBase58(value);
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
    const normalized = normalizeHexPrivateKey(privateKey);
    const account = privateKeyToAccount(normalized);
    return {
      address: account.address.toLowerCase(),
      privateKey: normalized,
      walletType: 'EVM',
    };
  } catch {
    throw new Error('Invalid EVM private key');
  }
}

export function deriveWalletFromPrivateKey(walletType: ImportWalletType, privateKey: string): DerivedWallet {
  if (!privateKey.trim()) throw new Error('Private key is required');
  if (walletType === 'EVM') return deriveEvmWallet(privateKey);
  if (walletType === 'SOLANA') return deriveSolanaWallet(privateKey);
  return deriveBitcoinWallet(privateKey);
}
