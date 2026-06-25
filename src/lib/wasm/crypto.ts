// WASM crypto module - client-side only (browser)
// The WASM files are compiled and available in public/wasm/
// This module only works in browser environment

type WasmCryptoModule = {
  default: () => Promise<unknown>;
  sign_transaction: (privateKeyHex: string, messageHex: string) => string;
  hash_message: (message: string) => string;
  verify_signature: (publicKeyHex: string, messageHex: string, signatureHex: string) => string;
  generate_keypair: () => string;
  encrypt_data: (plaintext: string, keyHex: string) => string;
  decrypt_data: (encryptedBase64: string, keyHex: string) => string;
};

let wasmModule: WasmCryptoModule | null = null;
let wasmInitialized = false;

async function ensureWasmInitialized() {
  if (!wasmInitialized) {
    try {
      // Load WASM module using dynamic import from public folder
      // This only works in browser environment
      if (typeof window === 'undefined') {
        throw new Error('WASM crypto only works in browser environment');
      }
      
      // @ts-expect-error - Dynamic import from public assets is resolved by the browser.
      wasmModule = await import('/wasm/wasm_crypto.js') as WasmCryptoModule;
      await wasmModule.default();
      wasmInitialized = true;
    } catch (error) {
      console.error('Failed to initialize WASM crypto:', error);
      throw new Error('WASM crypto initialization failed');
    }
  }
}

function getWasmModule() {
  if (!wasmModule) throw new Error('WASM crypto module is not initialized');
  return wasmModule;
}

export async function signTransactionWasm(privateKeyHex: string, messageHex: string): Promise<string> {
  await ensureWasmInitialized();
  return getWasmModule().sign_transaction(privateKeyHex, messageHex);
}

export async function hashMessageWasm(message: string): Promise<string> {
  await ensureWasmInitialized();
  return getWasmModule().hash_message(message);
}

export async function verifySignatureWasm(publicKeyHex: string, messageHex: string, signatureHex: string): Promise<string> {
  await ensureWasmInitialized();
  return getWasmModule().verify_signature(publicKeyHex, messageHex, signatureHex);
}

export async function generateKeypairWasm(): Promise<string> {
  await ensureWasmInitialized();
  return getWasmModule().generate_keypair();
}

export async function encryptDataWasm(plaintext: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return getWasmModule().encrypt_data(plaintext, keyHex);
}

export async function decryptDataWasm(encryptedBase64: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return getWasmModule().decrypt_data(encryptedBase64, keyHex);
}

export async function initializeWasmCrypto() {
  await ensureWasmInitialized();
}
