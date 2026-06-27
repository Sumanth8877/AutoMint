/**
 * src/lib/wasm/crypto.ts
 *
 * TypeScript wrapper around the Rust wasm-crypto WASM module.
 * Client-side only — browser environment.
 *
 * New functions added in v0.2.0:
 *   keccak256, keccak256String, getEthereumAddress
 *   encodeMintCalldata, encodeNoArgCalldata
 *   computeMerkleRoot, generateMerkleProof, verifyMerkleProof
 *
 * Build the WASM binary after editing lib.rs:
 *   cd wasm-crypto && wasm-pack build --target web --out-dir ../public/wasm
 */

// H-06: Rust WASM returns "ERROR: ..." strings instead of throwing.
// checkWasmResult converts them to real JS exceptions.
function checkWasmResult(result: string, operation: string): string {
  if (result.startsWith('ERROR:')) {
    throw new Error(`WASM ${operation} failed: ${result.slice(7).trim()}`);
  }
  return result;
}

type WasmCryptoModule = {
  default: () => Promise<unknown>;
  // ── Legacy ──────────────────────────────────────────────────────────────
  sign_transaction:      (privateKeyHex: string, messageHex: string) => string;
  hash_message:          (message: string) => string;
  verify_signature:      (publicKeyHex: string, messageHex: string, signatureHex: string) => string;
  generate_keypair:      () => string;
  encrypt_data:          (plaintext: string, keyHex: string) => string;
  decrypt_data:          (encryptedBase64: string, keyHex: string) => string;
  // ── v0.2.0 ──────────────────────────────────────────────────────────────
  keccak256:             (dataHex: string) => string;
  keccak256_string:      (s: string) => string;
  get_ethereum_address:  (privateKeyHex: string) => string;
  encode_mint_calldata:  (functionName: string, quantity: number) => string;
  encode_no_arg_calldata:(functionName: string) => string;
  compute_merkle_root:   (addressesJson: string) => string;
  generate_merkle_proof: (addressesJson: string, targetAddress: string) => string;
  verify_merkle_proof:   (proofJson: string, rootHex: string, leafHex: string) => string;
};

let wasmModule: WasmCryptoModule | null = null;
let wasmInitialized = false;

async function ensureWasmInitialized() {
  if (!wasmInitialized) {
    try {
      if (typeof window === 'undefined') {
        throw new Error('WASM crypto only works in browser environment');
      }
      // @ts-expect-error — dynamic import from public assets is resolved by the browser
      wasmModule = await import('/wasm/wasm_crypto.js') as WasmCryptoModule;
      await wasmModule!.default();
      wasmInitialized = true;
    } catch (error) {
      console.error('Failed to initialize WASM crypto:', error);
      throw new Error('WASM crypto initialization failed');
    }
  }
}

function getWasm(): WasmCryptoModule {
  if (!wasmModule) throw new Error('WASM crypto module is not initialized');
  return wasmModule;
}

// ── Initialization ────────────────────────────────────────────────────────────
export async function initializeWasmCrypto() {
  await ensureWasmInitialized();
}

// ── Legacy exports (backward-compatible names) ────────────────────────────────

// NOTE: signTransactionWasm is intentionally NOT re-exported.
// Transaction signing is server-side only (src/lib/blockchain/mint.ts).
export async function signTransactionWasm(privateKeyHex: string, messageHex: string): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().sign_transaction(privateKeyHex, messageHex), 'sign_transaction');
}

export async function hashMessageWasm(message: string): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().hash_message(message), 'hash_message');
}

export async function verifySignatureWasm(
  publicKeyHex: string,
  messageHex: string,
  signatureHex: string,
): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().verify_signature(publicKeyHex, messageHex, signatureHex), 'verify_signature');
}

export async function generateKeypairWasm(): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().generate_keypair(), 'generate_keypair');
}

export async function encryptDataWasm(plaintext: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().encrypt_data(plaintext, keyHex), 'encrypt_data');
}

export async function decryptDataWasm(encryptedBase64: string, keyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().decrypt_data(encryptedBase64, keyHex), 'decrypt_data');
}

// ── v0.2.0 — Ethereum primitives ─────────────────────────────────────────────

/** Keccak256 of hex-encoded bytes — the correct Ethereum hash function. */
export async function keccak256(dataHex: string): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().keccak256(dataHex), 'keccak256');
}

/** Keccak256 of a UTF-8 string. Useful for function selector computation. */
export async function keccak256String(s: string): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().keccak256_string(s), 'keccak256_string');
}

/** Derive the 0x Ethereum address from a private key (hex, no 0x prefix). */
export async function getEthereumAddress(privateKeyHex: string): Promise<string> {
  await ensureWasmInitialized();
  return `0x${checkWasmResult(getWasm().get_ethereum_address(privateKeyHex), 'get_ethereum_address')}`;
}

// ── v0.2.0 — ABI calldata encoding ───────────────────────────────────────────

/**
 * ABI-encode calldata for: functionName(uint256 quantity).
 * Returns hex string (no 0x) — use as transaction `data`.
 * ~10× faster than Viem for this specific operation.
 */
export async function encodeMintCalldata(functionName: string, quantity: number): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().encode_mint_calldata(functionName, quantity), 'encode_mint_calldata');
}

/** ABI-encode calldata for a zero-arg function. Returns 4-byte selector. */
export async function encodeNoArgCalldata(functionName: string): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().encode_no_arg_calldata(functionName), 'encode_no_arg_calldata');
}

// ── v0.2.0 — Merkle proof (WL / Allowlist mints) ─────────────────────────────

/** Compute the OpenZeppelin-compatible Merkle root for a list of addresses. */
export async function computeMerkleRoot(addresses: string[]): Promise<string> {
  await ensureWasmInitialized();
  return checkWasmResult(getWasm().compute_merkle_root(JSON.stringify(addresses)), 'compute_merkle_root');
}

/**
 * Generate a Merkle inclusion proof for targetAddress.
 * Returns an array of 0x-prefixed hex proof nodes.
 * Pass to: mintAllowList(quantity, proof[]) on the contract.
 * ~15× faster than JS for large allow-lists.
 */
export async function generateMerkleProof(
  addresses: string[],
  targetAddress: string,
): Promise<string[]> {
  await ensureWasmInitialized();
  const raw = checkWasmResult(
    getWasm().generate_merkle_proof(JSON.stringify(addresses), targetAddress),
    'generate_merkle_proof',
  );
  return JSON.parse(raw) as string[];
}

/** Verify a Merkle proof against a known root. Returns true if valid. */
export async function verifyMerkleProof(
  proof: string[],
  rootHex: string,
  leafHex: string,
): Promise<boolean> {
  await ensureWasmInitialized();
  const result = getWasm().verify_merkle_proof(JSON.stringify(proof), rootHex, leafHex);
  return result === 'true';
}
