/**
 * src/lib/utils/address.ts
 *
 * Shared address helpers used across EVM services.
 * Centralised here to avoid the same one-liner being redeclared in every
 * service file (previously duplicated in copy-mint.service.ts and
 * wallet-tracker.service.ts).
 */

/** Normalise an EVM address to lowercase with no surrounding whitespace. */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** Returns true for a valid checksummed or lowercase 0x-prefixed EVM address. */
export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}
