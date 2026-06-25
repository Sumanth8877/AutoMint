// WASM crypto module - client-side only (browser)
// The WASM files are compiled and available in public/wasm/
// This module only works in browser environment

let wasmModule: any = null;
let wasmInitialized = false;

async function ensureWasmInitialized() {
  if (!wasmInitialized) {
    try {
      // Load WASM module using dynamic import from public folder
      // This only works in browser environment
      if (typeof window === 'undefined') {
        throw new Error('WASM crypto only works in browser environment');
      }
      
      // @ts-ignore - Dynamic import from public folder
      wasmModule = await import('/wasm/wasm_crypto.js');
      await wasmModule.default();
      wasmInitialized = true;
    } catch (error) {
      console.error('Failed to initialize WASM crypto:', error);
      throw new Error('WASM crypto initialization failed');
    }
  }
}

export async function signTransactionWasm(privateKeyHex: string, messageHex: string): Promise<string> {
  await ensureWasmInitialized();
  return wasmModule.sign_transaction(privateKeyHex, messageHex);
}

export async function hashMessageWasm(message: string): Promise<string> {
  await ensureWasmInitialized();
  return wasmModule.hash_message(message);
}

export async function verifySignatureWasm(publicKeyHex: string, messageHex: string, signatureHex: string): Promise<string> {
  await ensureWasmInitialized();
  return wasmModule.verify_signature(publicKeyHex, messageHex, signatureHex);
}

export async function generateKeypairWasm(): Promise<string> {
  await ensureWasmInitialized();
  return wasmModule.generate_keypair();
}

export async function encryptDataWasm(plaintext: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return wasmModule.encrypt_data(plaintext, keyHex);
}

export async function decryptDataWasm(encryptedBase64: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return wasmModule.decrypt_data(encryptedBase64, keyHex);
}

export async function initializeWasmCrypto() {
  await ensureWasmInitialized();
}
