/**
 * Shared client-side input validation helpers.
 *
 * These are intentionally lightweight, dependency-free checks meant to give
 * immediate feedback before a network round-trip — the server remains the
 * source of truth and re-validates everything. Never rely on these alone
 * for security-sensitive checks.
 */

/** Standard 20-byte EVM address: 0x + 40 hex chars. */
export function isValidEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

/** Base58, roughly 32-44 chars — good enough for a client-side sanity check. */
export function isValidSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

/** Legacy (1...), P2SH (3...), or bech32 (bc1...) Bitcoin address formats. */
export function isValidBitcoinAddress(value: string): boolean {
  const v = value.trim();
  return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(v) || /^bc1[a-z0-9]{25,62}$/i.test(v);
}

export type WalletNetworkType = 'EVM' | 'SOLANA' | 'BITCOIN';

export function isValidWalletAddress(value: string, networkType: WalletNetworkType): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  switch (networkType) {
    case 'EVM': return isValidEvmAddress(trimmed);
    case 'SOLANA': return isValidSolanaAddress(trimmed);
    case 'BITCOIN': return isValidBitcoinAddress(trimmed);
    default: return trimmed.length > 0;
  }
}

/** Human-readable hint for the expected format, shown under the field. */
export function walletAddressHint(networkType: WalletNetworkType): string {
  switch (networkType) {
    case 'EVM': return 'Expected format: 0x followed by 40 hex characters.';
    case 'SOLANA': return 'Expected format: a base58 Solana address (32–44 characters).';
    case 'BITCOIN': return 'Expected format: a legacy (1…), P2SH (3…), or bech32 (bc1…) address.';
    default: return '';
  }
}

/**
 * Analyzer / mint input accepts either a full URL or a bare EVM contract
 * address. Rejects obviously-invalid input (empty, stray whitespace-only,
 * or garbage that is neither).
 */
export function isValidMintInput(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (isValidEvmAddress(trimmed)) return true;
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return Boolean(url.hostname && url.hostname.includes('.'));
  } catch {
    return false;
  }
}

/** Trim + collapse internal whitespace — useful for names/search queries. */
export function sanitizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Clamp a numeric string input into [min, max], returning null if not a valid number. */
export function clampNumeric(value: string, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
