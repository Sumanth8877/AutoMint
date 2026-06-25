import init, { sign_transaction, hash_message, verify_signature, generate_keypair, encrypt_data, decrypt_data } from '../../../public/wasm/wasm_crypto';

let wasmInitialized = false;

async function ensureWasmInitialized() {
  if (!wasmInitialized) {
    await init();
    wasmInitialized = true;
  }
}

export async function signTransactionWasm(privateKeyHex: string, messageHex: string): Promise<string> {
  await ensureWasmInitialized();
  return sign_transaction(privateKeyHex, messageHex);
}

export async function hashMessageWasm(message: string): Promise<string> {
  await ensureWasmInitialized();
  return hash_message(message);
}

export async function verifySignatureWasm(publicKeyHex: string, messageHex: string, signatureHex: string): Promise<string> {
  await ensureWasmInitialized();
  return verify_signature(publicKeyHex, messageHex, signatureHex);
}

export async function generateKeypairWasm(): Promise<string> {
  await ensureWasmInitialized();
  return generate_keypair();
}

export async function encryptDataWasm(plaintext: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return encrypt_data(plaintext, keyHex);
}

export async function decryptDataWasm(encryptedBase64: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return decrypt_data(encryptedBase64, keyHex);
}

export async function initializeWasmCrypto() {
  await ensureWasmInitialized();
}
