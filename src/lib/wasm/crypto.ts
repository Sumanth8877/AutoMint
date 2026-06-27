/**
 * src/lib/wasm/crypto.ts
 *
 * TypeScript wrapper around the Rust wasm-crypto WASM module.
 *
 * Exposed Rust functions:
 *
 *  ETHEREUM PRIMITIVES
 *  ─────────────────────────────────────────────────────────────────
 *  keccak256(dataHex)              → hash hex string with Keccak256
 *  keccak256String(s)              → hash UTF-8 string with Keccak256
 *  getEthereumAddress(privKeyHex)  → derive 0x address from private key
 *
 *  ABI CALLDATA ENCODING (pure Rust — no network)
 *  ─────────────────────────────────────────────────────────────────
 *  encodeMintCalldata(fn, qty)     → ABI calldata for fnName(uint256)
 *  encodeNoArgCalldata(fn)         → ABI calldata for fnName()
 *
 *  MERKLE PROOF (WL / Allowlist mints — 10-50× faster than JS)
 *  ─────────────────────────────────────────────────────────────────
 *  computeMerkleRoot(addrsJson)    → hex root for a list of addresses
 *  generateMerkleProof(addrsJson, target) → proof array (JSON string)
 *  verifyMerkleProof(proofJson, root, leaf) → "true" | "false"
 *
 *  LEGACY (kept for backward-compatibility)
 *  ─────────────────────────────────────────────────────────────────
 *  signTransaction(privKey, msgHex)
 *  verifySignature(pubKey, msgHex, sigHex)
 *  generateKeypair()
 *  encryptData(plaintext, keyHex)
 *  decryptData(encryptedB64, keyHex)
 *  hashMessage(message)   ← SHA-256 (NOT keccak256 — use keccak256() for EVM)
 *
 * Build the WASM binary:
 *   cd wasm-crypto && wasm-pack build --target web --out-dir ../public/wasm
 */

let wasmModule: {
  // ── Ethereum primitives ──────────────────────────────────────────────────
  keccak256:           (dataHex: string) => string;
  keccak256_string:    (s: string) => string;
  get_ethereum_address:(privKeyHex: string) => string;
  // ── ABI encoding ─────────────────────────────────────────────────────────
  encode_mint_calldata:(functionName: string, quantity: number) => string;
  encode_no_arg_calldata:(functionName: string) => string;
  // ── Merkle proof ─────────────────────────────────────────────────────────
  compute_merkle_root: (addressesJson: string) => string;
  generate_merkle_proof:(addressesJson: string, targetAddress: string) => string;
  verify_merkle_proof: (proofJson: string, rootHex: string, leafHex: string) => string;
  // ── Legacy ───────────────────────────────────────────────────────────────
  sign_transaction:    (privateKeyHex: string, messageHex: string) => string;
  verify_signature:    (publicKeyHex: string, messageHex: string, signatureHex: string) => string;
  generate_keypair:    () => string;
  encrypt_data:        (plaintext: string, keyHex: string) => string;
  decrypt_data:        (encryptedBase64: string, keyHex: string) => string;
  hash_message:        (message: string) => string;
} | null = null;

async function loadWasm() {
  if (wasmModule) return wasmModule;
  try {
    const wasm = await import('/wasm/wasm_crypto.js');
    await wasm.default();
    wasmModule = wasm as typeof wasmModule;
    return wasmModule;
  } catch {
    return null;
  }
}

function assertNoError(result: string, context: string): string {
  if (result.startsWith('ERROR:')) throw new Error(`[wasm-crypto] ${context}: ${result}`);
  return result;
}

// ── Ethereum primitives ──────────────────────────────────────────────────────

export async function keccak256(dataHex: string): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.keccak256(dataHex), 'keccak256');
}

export async function keccak256String(s: string): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.keccak256_string(s), 'keccak256String');
}

export async function getEthereumAddress(privateKeyHex: string): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return `0x${assertNoError(wasm.get_ethereum_address(privateKeyHex), 'getEthereumAddress')}`;
}

// ── ABI calldata encoding ────────────────────────────────────────────────────

/**
 * Encode ABI calldata for a mint function: functionName(uint256 quantity)
 * Returns hex string (no 0x prefix) to use as transaction `data`.
 *
 * Example: encodeMintCalldata("mint", 1) → "a0712d68" + 32-byte uint256(1)
 */
export async function encodeMintCalldata(functionName: string, quantity: number): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.encode_mint_calldata(functionName, quantity), 'encodeMintCalldata');
}

/**
 * Encode ABI calldata for a zero-arg function: functionName()
 * Returns the 4-byte function selector as hex.
 */
export async function encodeNoArgCalldata(functionName: string): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.encode_no_arg_calldata(functionName), 'encodeNoArgCalldata');
}

// ── Merkle proof ─────────────────────────────────────────────────────────────

/**
 * Compute the OpenZeppelin-compatible Merkle root for a list of addresses.
 * Used to verify the root matches the one stored in the contract.
 */
export async function computeMerkleRoot(addresses: string[]): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.compute_merkle_root(JSON.stringify(addresses)), 'computeMerkleRoot');
}

/**
 * Generate a Merkle proof for targetAddress from the full allow-list.
 * Returns an array of 0x-prefixed hex proof nodes.
 *
 * Pass these nodes to the contract's mintAllowList(quantity, proof[]) function.
 */
export async function generateMerkleProof(
  addresses: string[],
  targetAddress: string,
): Promise<string[]> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  const raw = assertNoError(
    wasm.generate_merkle_proof(JSON.stringify(addresses), targetAddress),
    'generateMerkleProof',
  );
  return JSON.parse(raw) as string[];
}

/**
 * Verify that a proof is valid for a leaf against a known root.
 * Returns true if the proof is valid.
 */
export async function verifyMerkleProof(
  proof: string[],
  rootHex: string,
  leafHex: string,
): Promise<boolean> {
  const wasm = await loadWasm();
  if (!wasm) return false;
  const result = wasm.verify_merkle_proof(JSON.stringify(proof), rootHex, leafHex);
  return result === 'true';
}

// ── Legacy functions ─────────────────────────────────────────────────────────

export async function signTransaction(privateKeyHex: string, messageHex: string): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.sign_transaction(privateKeyHex, messageHex), 'signTransaction');
}

export async function verifySignature(publicKeyHex: string, messageHex: string, signatureHex: string): Promise<boolean> {
  const wasm = await loadWasm();
  if (!wasm) return false;
  const result = wasm.verify_signature(publicKeyHex, messageHex, signatureHex);
  return result === 'true';
}

export async function generateKeypair(): Promise<{ privateKey: string; publicKey: string }> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  const result = assertNoError(wasm.generate_keypair(), 'generateKeypair');
  const [privateKey, publicKey] = result.split('|');
  return { privateKey, publicKey };
}

export async function encryptData(plaintext: string, keyHex: string): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.encrypt_data(plaintext, keyHex), 'encryptData');
}

export async function decryptData(encryptedBase64: string, keyHex: string): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.decrypt_data(encryptedBase64, keyHex), 'decryptData');
}

/** SHA-256 hash — NOT the Ethereum hash. Use keccak256() for EVM operations. */
export async function hashMessage(message: string): Promise<string> {
  const wasm = await loadWasm();
  if (!wasm) throw new Error('WASM not available');
  return assertNoError(wasm.hash_message(message), 'hashMessage');
}
