// WASM crypto module — client-side only (browser)
// The WASM files are compiled and available in public/wasm/
// This module only works in a browser environment.

// H-06 Fix: the Rust WASM implementation returns "ERROR: <message>" strings
// on failure instead of throwing JavaScript exceptions. This is a Rust/WASM
// interop limitation: wasm-bindgen does not automatically propagate Rust
// panics as JS errors in all paths.
//
// Without this guard, callers receive an error string and silently treat it
// as a valid result — e.g. storing "ERROR: invalid key length" as a signature.
//
// checkWasmResult() inspects every return value. If it starts with "ERROR:",
// it throws a real JavaScript Error so callers get a proper exception instead
// of a silent bad value. This wraps every exported WASM function below.

function checkWasmResult(result: string, operation: string): string {
  if (result.startsWith('ERROR:')) {
    throw new Error(`WASM ${operation} failed: ${result.slice(7).trim()}`);
  }
  return result;
}

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
      if (typeof window === 'undefined') {
        throw new Error('WASM crypto only works in browser environment');
      }
      // @ts-expect-error — dynamic import from public assets is resolved by the browser.
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

// NOTE: signTransactionWasm is intentionally NOT re-exported.
// Transaction signing is server-side only (src/lib/blockchain/mint.ts).
// See H-05 in the security audit for rationale.
export async function signTransactionWasm(privateKeyHex: string, messageHex: string): Promise<string> {
  await ensureWasmInitialized();
  const result = getWasmModule().sign_transaction(privateKeyHex, messageHex);
  return checkWasmResult(result, 'sign_transaction');
}

export async function hashMessageWasm(message: string): Promise<string> {
  await ensureWasmInitialized();
  const result = getWasmModule().hash_message(message);
  return checkWasmResult(result, 'hash_message');
}

export async function verifySignatureWasm(
  publicKeyHex: string,
  messageHex: string,
  signatureHex: string,
): Promise<string> {
  await ensureWasmInitialized();
  const result = getWasmModule().verify_signature(publicKeyHex, messageHex, signatureHex);
  return checkWasmResult(result, 'verify_signature');
}

export async function generateKeypairWasm(): Promise<string> {
  await ensureWasmInitialized();
  const result = getWasmModule().generate_keypair();
  return checkWasmResult(result, 'generate_keypair');
}

export async function encryptDataWasm(plaintext: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  const result = getWasmModule().encrypt_data(plaintext, keyHex);
  return checkWasmResult(result, 'encrypt_data');
}

export async function decryptDataWasm(encryptedBase64: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  const result = getWasmModule().decrypt_data(encryptedBase64, keyHex);
  return checkWasmResult(result, 'decrypt_data');
}

export async function initializeWasmCrypto() {
  await ensureWasmInitialized();
}
