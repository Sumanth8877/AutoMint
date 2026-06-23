import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ── AES-256-GCM encryption with key rotation support ─────────────────────────
//
// ENCRYPTED VALUE FORMAT
//   v1:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
//
//   All existing ciphertexts use this format. The "v1" prefix is the format
//   version — it does NOT identify which encryption key was used.
//
// KEY ROTATION
//   When you need to rotate the encryption key:
//
//   1. Generate a new 32-byte key:
//        openssl rand -hex 64
//
//   2. In your environment:
//        ENCRYPTION_KEY=<new_key>          ← used for all new encryptions
//        ENCRYPTION_KEY_PREVIOUS=<old_key> ← used as fallback during decrypt
//
//   3. Re-encrypt all wallets (run the migration script below) and then
//      remove ENCRYPTION_KEY_PREVIOUS once migration is confirmed.
//
//   decrypt() tries ENCRYPTION_KEY first, then falls back to
//   ENCRYPTION_KEY_PREVIOUS. This allows a zero-downtime rotation:
//   new keys encrypt new data while old keys still decrypt existing data.
//
// ADDING MORE PREVIOUS KEYS
//   If you need more than one previous key, use a comma-separated list:
//     ENCRYPTION_KEY_PREVIOUS=key1,key2
//   decrypt() will try each in order after the current key fails.
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

/** Returns the active encryption key (used for new encryptions). */
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
          // Log misconfigured previous key but do not crash — it just won't be tried.
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
      // AES-GCM auth tag mismatch — wrong key, try the next one.
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // All keys failed — either the ciphertext is corrupt or all keys are wrong.
  throw new Error(
    `Decryption failed with all ${keys.length} configured key(s). ` +
    `If you rotated ENCRYPTION_KEY, ensure the old key is in ENCRYPTION_KEY_PREVIOUS. ` +
    `Original error: ${lastError?.message ?? 'unknown'}`,
  );
}

export function encryptPrivateKey(privateKey: string): string {
  return encrypt(privateKey);
}

export function decryptPrivateKey(payload: string | { encrypted?: string; value?: string }): string {
  const encrypted = typeof payload === 'string' ? payload : payload.encrypted ?? payload.value;
  if (!encrypted) throw new Error('Encrypted private key payload is invalid');
  return decrypt(encrypted);
}

// ── Key rotation helper ───────────────────────────────────────────────────────
//
// Call this after setting ENCRYPTION_KEY to the new key and
// ENCRYPTION_KEY_PREVIOUS to the old key. It re-encrypts the given ciphertext
// with the active key so it no longer depends on the previous key.
//
// Usage (from a migration script):
//   import { rotateEncryption } from '@/lib/security/encryption';
//   const newCipher = rotateEncryption(wallet.encryptedPrivateKey);
//   await db.update(wallets).set({ encryptedPrivateKey: newCipher }).where(eq(wallets.id, wallet.id));
//
export function rotateEncryption(oldCiphertext: string): string {
  const plaintext = decrypt(oldCiphertext); // uses the key chain (old or new key)
  return encrypt(plaintext);               // always uses the active key
}
