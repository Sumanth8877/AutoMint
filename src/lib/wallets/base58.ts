/**
 * src/lib/wallets/base58.ts
 *
 * Shared Base58 encoding/decoding utility.
 * Used by both wallet detection (detection.ts) and private key derivation (private-key.ts).
 * Single source of truth — do NOT duplicate this logic elsewhere.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decode a Base58 string into a byte array.
 * Returns null for invalid input (unknown characters, empty string).
 */
export function decodeBase58(value: string): Uint8Array | null {
  if (!value) return null;

  const bytes = [0];

  for (const char of value) {
    const carryStart = BASE58_ALPHABET.indexOf(char);
    if (carryStart === -1) return null; // invalid character

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

/**
 * Decode a Base58 string, throwing on invalid input.
 * Use this in key-derivation paths where invalid input is a hard error.
 */
export function decodeBase58OrThrow(value: string): Buffer {
  if (!value) throw new Error('Invalid private key format');

  const result = decodeBase58(value);
  if (!result) throw new Error('Invalid private key format');

  return Buffer.from(result);
}

/**
 * Encode a Buffer as a Base58 string.
 */
export function encodeBase58(bytes: Buffer): string {
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
