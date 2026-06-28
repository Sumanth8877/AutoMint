import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ── AES-256-GCM encryption with key rotation support ──────────────────────────
//
// ENCRYPTED VALUE FORMAT
//   v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
//
//   All existing ciphertexts use this format. The "v1" prefix is the format
//   version — it does NOT identify which encryption key was used.
//
// KEY ROTATION WORKFLOW
// ─────────────────────
// 1. Generate a new 32-byte key (64 hex chars — matches the validator):
//      openssl rand -hex 32
//
// 2. Set env vars (zero-downtime — old key still decrypts during migration):
//      ENCRYPTION_KEY=<new_key>
//      ENCRYPTION_KEY_PREVIOUS=<old_key>   ← comma-separated if multiple
//
// 3. Re-encrypt all stored values:
//      import { rotateAllIntegrationSettings } from
//        '@/lib/services/integration-settings.service';
//      await rotateAllIntegrationSettings();
//
// 4. Once migration is confirmed, remove ENCRYPTION_KEY_PREVIOUS.
//
// HOW IT WORKS
//   decrypt() tries ENCRYPTION_KEY first, then each key in
//   ENCRYPTION_KEY_PREVIOUS. This lets new rows use the new key while
//   old rows (not yet re-encrypted) still decrypt with the old key.
//
//   rotateEncryption(ciphertext) decrypts with the key chain and
//   re-encrypts with the active key — no plaintext escapes memory.
// ─────────────────────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function parseKey(raw: string, envName: string): Buffer {
  const trimmed = raw.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error(`${envName} must be a 32-byte base64 or 64-character hex value`);
  }
  return key;
}

/** Returns the active encryption key (used for all new encryptions). */
function getActiveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not configured');
  return parseKey(raw, 'ENCRYPTION_KEY');
}

/**
 * Returns all decryption keys to try, in priority order:
 *   [activeKey, ...previousKeys]
 *
 * During key rotation, ENCRYPTION_KEY_PREVIOUS contains the old key(s) so
 * that existing ciphertexts can still be decrypted while new data uses the
 * current ENCRYPTION_KEY.
 */
function getDecryptionKeyChain(): Buffer[] {
  const keys: Buffer[] = [getActiveKey()];

  const previousRaw = process.env.ENCRYPTION_KEY_PREVIOUS;
  if (previousRaw) {
    for (const segment of previousRaw.split(',')) {
      const trimmed = segment.trim();
      if (trimmed) {
        try {
          keys.push(parseKey(trimmed, 'ENCRYPTION_KEY_PREVIOUS'));
        } catch {
          console.error('[encryption] Skipping malformed key in ENCRYPTION_KEY_PREVIOUS');
        }
      }
    }
  }

  return keys;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function encrypt(text: string): string {
  if (!text) throw new Error('Cannot encrypt an empty value');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getActiveKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decrypt(text: string): string {
  const [version, ivBase64, tagBase64, encryptedBase64] = text.split(':');
  if (version !== 'v1' || !ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('Encrypted value format is invalid');
  }

  const iv = Buffer.from(ivBase64, 'base64url');
  const tag = Buffer.from(tagBase64, 'base64url');
  const ciphertext = Buffer.from(encryptedBase64, 'base64url');

  const keys = getDecryptionKeyChain();
  let lastError: Error | undefined;

  for (const key of keys) {
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error(
    `Decryption failed with all ${keys.length} configured key(s). ` +
    `If you rotated ENCRYPTION_KEY, ensure the old key is in ENCRYPTION_KEY_PREVIOUS. ` +
    `Original error: ${lastError?.message ?? 'unknown'}`,
  );
}

// ── Private key helpers ───────────────────────────────────────────────────────

const EVM_PK_RE = /^(0x)?[a-f0-9]{64}$/i;
const SOLANA_B58_MIN_LEN = 32;
const SOLANA_B58_MAX_LEN = 88;

/**
 * Encrypt a private key after basic format validation.
 * Rejects obviously invalid keys before they reach the encryption layer.
 */
export function encryptPrivateKey(privateKey: string): string {
  const trimmed = privateKey?.trim();
  if (!trimmed) throw new Error('Private key must not be empty');

  const isEvm = EVM_PK_RE.test(trimmed);
  const couldBeSolanaOrBitcoin =
    trimmed.length >= SOLANA_B58_MIN_LEN && trimmed.length <= SOLANA_B58_MAX_LEN + 10;
  const couldBeJsonArray = trimmed.startsWith('[');

  if (!isEvm && !couldBeSolanaOrBitcoin && !couldBeJsonArray) {
    throw new Error(
      'Private key format is invalid. Expected a 64-char hex EVM key, a Base58 Solana/Bitcoin key, or a Solana JSON keypair array.',
    );
  }

  return encrypt(trimmed);
}

export function decryptPrivateKey(payload: string | { encrypted?: string; value?: string }): string {
  const encrypted = typeof payload === 'string' ? payload : payload.encrypted ?? payload.value;
  if (!encrypted) throw new Error('Encrypted private key payload is invalid');
  return decrypt(encrypted);
}

// ── Key rotation helper ───────────────────────────────────────────────────────
//
// Re-encrypts a single ciphertext with the active key.
// Used by rotateAllIntegrationSettings() in integration-settings.service.ts.
//
// Usage (ad-hoc rotation of a single value):
//   const newCipher = rotateEncryption(wallet.encryptedPrivateKey);
//   await db.update(wallets).set({ encryptedPrivateKey: newCipher })
//           .where(eq(wallets.id, wallet.id));
//
export function rotateEncryption(oldCiphertext: string): string {
  const plaintext = decrypt(oldCiphertext); // tries the full key chain
  return encrypt(plaintext);               // always uses the active key
}
