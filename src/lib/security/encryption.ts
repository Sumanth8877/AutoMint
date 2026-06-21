import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not configured');

  const trimmed = raw.trim();
  const key = /^[a-f0-9]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new Error('ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex value');
  }

  return key;
}

export function encrypt(text: string) {
  if (!text) throw new Error('Cannot encrypt an empty value');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decrypt(text: string) {
  const [version, ivBase64, tagBase64, encryptedBase64] = text.split(':');
  if (version !== 'v1' || !ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('Encrypted value format is invalid');
  }

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivBase64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptPrivateKey(privateKey: string) {
  return encrypt(privateKey);
}

export function decryptPrivateKey(payload: string | { encrypted?: string; value?: string }) {
  const encrypted = typeof payload === 'string' ? payload : payload.encrypted ?? payload.value;
  if (!encrypted) throw new Error('Encrypted private key payload is invalid');
  return decrypt(encrypted);
}
