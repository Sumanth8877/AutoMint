/**
 * AES-256-GCM encryption for wallet private keys.
 *
 * Production notes:
 * - Master key should come from a secrets manager (Vercel Environment Variables,
 *   AWS Secrets Manager, etc.), NOT hardcoded.
 * - For Vercel: store ENCRYPTION_MASTER_KEY in project env.
 * - Key format: 32-byte hex string (64 chars) for AES-256.
 */

import crypto from 'crypto';

const MASTER_KEY_HEX = process.env.ENCRYPTION_MASTER_KEY || '';

export function getMasterKey(): Buffer {
  if (!MASTER_KEY_HEX) {
    throw new Error('ENCRYPTION_MASTER_KEY is not configured');
  }
  const buf = Buffer.from(MASTER_KEY_HEX, 'hex');
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_MASTER_KEY must be 64 hex characters (32 bytes)');
  }
  return buf;
}

export interface EncryptedPayload {
  ciphertext: string;      // hex
  iv: string;               // hex
  tag: string;              // hex (auth tag)
  version: number;          // encryption version for rotation
}

/**
 * Encrypt a private key string.
 * Returns JSON-serializable payload.
 */
export function encryptPrivateKey(privateKeyPlain: string): EncryptedPayload {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(privateKeyPlain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    version: 1,
  };
}

/**
 * Decrypt a payload back to private key plaintext.
 */
export function decryptPrivateKey(payload: EncryptedPayload): string {
  const key = getMasterKey();
  const iv = Buffer.from(payload.iv, 'hex');
  const tag = Buffer.from(payload.tag, 'hex');
  const ciphertext = Buffer.from(payload.ciphertext, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv as Buffer);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}