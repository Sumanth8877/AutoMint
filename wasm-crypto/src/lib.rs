use wasm_bindgen::prelude::*;
use k256::ecdsa::{SigningKey, Signature, VerifyingKey, signature::Signer, signature::Verifier};
use k256::sha2::{Sha256, Digest as Sha256Digest};
use sha3::{Keccak256, Digest as KeccakDigest};
use hex::{encode, decode};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use aes_gcm::aead::Aead;
use base64::{Engine as _, engine::general_purpose};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn keccak256_bytes(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Left-pad a u64 to 32 bytes (EVM uint256 encoding).
fn abi_encode_u256(value: u64) -> [u8; 32] {
    let mut buf = [0u8; 32];
    buf[24..].copy_from_slice(&value.to_be_bytes());
    buf
}

/// Encode a 20-byte Ethereum address as a 32-byte ABI word (zero-padded left).
fn abi_encode_address(addr: &[u8; 20]) -> [u8; 32] {
    let mut buf = [0u8; 32];
    buf[12..].copy_from_slice(addr);
    buf
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Keccak256 — the Ethereum hash function
// ─────────────────────────────────────────────────────────────────────────────

/// Compute keccak256 of hex-encoded input bytes.
/// Input:  hex string (e.g. "deadbeef")
/// Output: hex string of the 32-byte hash
#[wasm_bindgen]
pub fn keccak256(data_hex: &str) -> String {
    console_error_panic_hook::set_once();
    match decode(data_hex) {
        Ok(bytes) => encode(keccak256_bytes(&bytes)),
        Err(e)    => format!("ERROR: {e}"),
    }
}

/// Compute keccak256 of a UTF-8 string (convenience for selector computation).
#[wasm_bindgen]
pub fn keccak256_string(s: &str) -> String {
    console_error_panic_hook::set_once();
    encode(keccak256_bytes(s.as_bytes()))
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ABI calldata encoding for ERC-721 mint functions
// ─────────────────────────────────────────────────────────────────────────────

/// Encode ABI calldata for:  functionName(uint256 quantity)
///
/// Returns hex string (no 0x prefix) ready to pass as `data` on a transaction.
/// The caller uses this for:  mint(1), publicMint(1), claim(1), etc.
///
/// Example:
///   encode_mint_calldata("mint", 1)
///   → "a0712d68" + 32-byte zero-padded 1
#[wasm_bindgen]
pub fn encode_mint_calldata(function_name: &str, quantity: u32) -> String {
    console_error_panic_hook::set_once();

    // Function selector = first 4 bytes of keccak256("functionName(uint256)")
    let sig = format!("{function_name}(uint256)");
    let hash = keccak256_bytes(sig.as_bytes());
    let selector = &hash[..4];

    // ABI-encode the uint256 argument (left-padded to 32 bytes)
    let arg = abi_encode_u256(quantity as u64);

    let mut calldata = Vec::with_capacity(4 + 32);
    calldata.extend_from_slice(selector);
    calldata.extend_from_slice(&arg);
    encode(calldata)
}

/// Encode calldata for functions that take NO arguments:
///   functionName()
#[wasm_bindgen]
pub fn encode_no_arg_calldata(function_name: &str) -> String {
    console_error_panic_hook::set_once();
    let sig = format!("{function_name}()");
    let hash = keccak256_bytes(sig.as_bytes());
    encode(&hash[..4])
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Merkle proof — for WL / Allowlist mints
// ─────────────────────────────────────────────────────────────────────────────
//
// Implements the OpenZeppelin MerkleTree standard used by virtually all
// WL-gated NFT contracts:
//   leaf  = keccak256(abi.encodePacked(address))
//   node  = keccak256(abi.encodePacked(min(left,right), max(left,right)))
//           (sorted so the tree is deterministic regardless of input order)
//
// Usage:
//   1. get the full allow-list from the project (JSON array of addresses)
//   2. call generate_merkle_proof(addresses_json, your_address)
//   3. pass the returned proof array to the contract's WL mint function

fn address_to_leaf(addr_hex: &str) -> Result<[u8; 32], String> {
    let cleaned = addr_hex.trim_start_matches("0x");
    let bytes = decode(cleaned).map_err(|e| e.to_string())?;
    if bytes.len() != 20 {
        return Err(format!("Expected 20-byte address, got {}", bytes.len()));
    }
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&bytes);
    // OpenZeppelin double-hashes: leaf = keccak256(keccak256(abi.encodePacked(addr)))
    let packed = abi_encode_address(&addr);  // 32-byte zero-padded address
    // Actually OZ uses: keccak256(abi.encodePacked(account)) = keccak256(20 bytes)
    let inner = keccak256_bytes(&addr);      // hash of the raw 20-byte address
    Ok(keccak256_bytes(&inner))              // double-hash (OZ MerkleTree standard)
}

fn combine_hashes(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    // Sort so the result is deterministic regardless of left/right order
    let (left, right) = if a <= b { (a, b) } else { (b, a) };
    let mut combined = [0u8; 64];
    combined[..32].copy_from_slice(left);
    combined[32..].copy_from_slice(right);
    keccak256_bytes(&combined)
}

/// Compute the Merkle root for a list of addresses.
///
/// addresses_json: JSON array of hex addresses, e.g. ["0xabc...", "0xdef..."]
/// Returns: hex string of the 32-byte root
#[wasm_bindgen]
pub fn compute_merkle_root(addresses_json: &str) -> String {
    console_error_panic_hook::set_once();
    match compute_merkle_root_internal(addresses_json) {
        Ok(root)  => encode(root),
        Err(e)    => format!("ERROR: {e}"),
    }
}

fn compute_merkle_root_internal(addresses_json: &str) -> Result<[u8; 32], String> {
    let addresses: Vec<String> = serde_json::from_str(addresses_json)
        .map_err(|e| format!("Invalid JSON: {e}"))?;
    if addresses.is_empty() {
        return Err("Empty address list".into());
    }

    let mut leaves: Vec<[u8; 32]> = addresses.iter()
        .map(|a| address_to_leaf(a))
        .collect::<Result<_, _>>()?;
    leaves.sort();                       // canonical sort for determinism

    while leaves.len() > 1 {
        let mut next = Vec::new();
        for chunk in leaves.chunks(2) {
            if chunk.len() == 2 {
                next.push(combine_hashes(&chunk[0], &chunk[1]));
            } else {
                next.push(chunk[0]);     // odd node carries up unchanged
            }
        }
        leaves = next;
    }
    Ok(leaves[0])
}

/// Generate a Merkle proof for a specific address in the allow-list.
///
/// addresses_json:  JSON array of all allow-listed addresses
/// target_address:  the address to prove membership for (0x-prefixed)
/// Returns:         JSON array of hex proof nodes, or "ERROR: ..." on failure.
///
/// Pass each element of the returned array as `bytes32` to the contract.
#[wasm_bindgen]
pub fn generate_merkle_proof(addresses_json: &str, target_address: &str) -> String {
    console_error_panic_hook::set_once();
    match generate_merkle_proof_internal(addresses_json, target_address) {
        Ok(proof) => {
            let hex_proof: Vec<String> = proof.iter().map(|h| format!("0x{}", encode(h))).collect();
            serde_json::to_string(&hex_proof).unwrap_or_else(|_| "ERROR: serialisation failed".into())
        },
        Err(e) => format!("ERROR: {e}"),
    }
}

fn generate_merkle_proof_internal(
    addresses_json: &str,
    target_address: &str,
) -> Result<Vec<[u8; 32]>, String> {
    let addresses: Vec<String> = serde_json::from_str(addresses_json)
        .map_err(|e| format!("Invalid JSON: {e}"))?;

    let target_leaf = address_to_leaf(target_address)?;

    let mut leaves: Vec<[u8; 32]> = addresses.iter()
        .map(|a| address_to_leaf(a))
        .collect::<Result<_, _>>()?;
    leaves.sort();

    let target_idx = leaves.iter().position(|l| l == &target_leaf)
        .ok_or("Address not found in allow-list")?;

    let mut proof = Vec::new();
    let mut layer = leaves.clone();
    let mut idx   = target_idx;

    while layer.len() > 1 {
        let sibling_idx = if idx % 2 == 0 {
            if idx + 1 < layer.len() { idx + 1 } else { idx }
        } else {
            idx - 1
        };
        proof.push(layer[sibling_idx]);
        idx /= 2;

        let mut next = Vec::new();
        for chunk in layer.chunks(2) {
            if chunk.len() == 2 {
                next.push(combine_hashes(&chunk[0], &chunk[1]));
            } else {
                next.push(chunk[0]);
            }
        }
        layer = next;
    }
    Ok(proof)
}

/// Verify a Merkle proof for a leaf against a known root.
///
/// proof_json:  JSON array of hex proof nodes (from generate_merkle_proof)
/// root_hex:    expected Merkle root (from the contract)
/// leaf_hex:    the leaf hash to verify (keccak256 of the address)
/// Returns:     "true" or "false"
#[wasm_bindgen]
pub fn verify_merkle_proof(proof_json: &str, root_hex: &str, leaf_hex: &str) -> String {
    console_error_panic_hook::set_once();
    match verify_merkle_proof_internal(proof_json, root_hex, leaf_hex) {
        Ok(result) => result.to_string(),
        Err(e)     => format!("ERROR: {e}"),
    }
}

fn verify_merkle_proof_internal(
    proof_json: &str,
    root_hex: &str,
    leaf_hex: &str,
) -> Result<bool, String> {
    let proof_strs: Vec<String> = serde_json::from_str(proof_json)
        .map_err(|e| format!("Invalid proof JSON: {e}"))?;

    let proof: Vec<[u8; 32]> = proof_strs.iter().map(|s| {
        let clean = s.trim_start_matches("0x");
        let bytes = decode(clean).map_err(|e| e.to_string())?;
        if bytes.len() != 32 { return Err("Proof node must be 32 bytes".into()); }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(arr)
    }).collect::<Result<_, String>>()?;

    let root_bytes = decode(root_hex.trim_start_matches("0x"))
        .map_err(|e| e.to_string())?;
    if root_bytes.len() != 32 { return Err("Root must be 32 bytes".into()); }
    let mut root = [0u8; 32];
    root.copy_from_slice(&root_bytes);

    let leaf_bytes = decode(leaf_hex.trim_start_matches("0x"))
        .map_err(|e| e.to_string())?;
    if leaf_bytes.len() != 32 { return Err("Leaf must be 32 bytes".into()); }
    let mut computed = [0u8; 32];
    computed.copy_from_slice(&leaf_bytes);

    for sibling in &proof {
        computed = combine_hashes(&computed, sibling);
    }
    Ok(computed == root)
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Ethereum address derivation
// ─────────────────────────────────────────────────────────────────────────────

/// Derive the Ethereum address from a private key (hex, no 0x prefix).
/// Returns: hex string of the 20-byte address (no 0x prefix).
#[wasm_bindgen]
pub fn get_ethereum_address(private_key_hex: &str) -> String {
    console_error_panic_hook::set_once();
    match get_ethereum_address_internal(private_key_hex) {
        Ok(addr) => addr,
        Err(e)   => format!("ERROR: {e}"),
    }
}

fn get_ethereum_address_internal(private_key_hex: &str) -> Result<String, Box<dyn std::error::Error>> {
    let key_bytes = decode(private_key_hex.trim_start_matches("0x"))?;
    let signing_key = SigningKey::from_slice(&key_bytes)?;
    let verifying_key = VerifyingKey::from(&signing_key);

    // Uncompressed pubkey = 04 || x || y (65 bytes). Take x||y (drop 04 prefix).
    let pubkey_bytes = verifying_key.to_encoded_point(false);
    let pubkey_xy = &pubkey_bytes.as_bytes()[1..]; // drop the 04 prefix (64 bytes)

    // Ethereum address = last 20 bytes of keccak256(pubkey_xy)
    let hash = keccak256_bytes(pubkey_xy);
    Ok(encode(&hash[12..]))  // last 20 bytes
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Legacy functions (kept for backward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

/// SHA-256 hash (NOT Ethereum-standard — use keccak256 for EVM work).
#[wasm_bindgen]
pub fn hash_message(message: &str) -> String {
    console_error_panic_hook::set_once();
    let mut hasher = Sha256::new();
    hasher.update(message.as_bytes());
    encode(hasher.finalize())
}

#[wasm_bindgen]
pub fn sign_transaction(private_key_hex: &str, message_hex: &str) -> String {
    console_error_panic_hook::set_once();
    match sign_transaction_internal(private_key_hex, message_hex) {
        Ok(s) => s,
        Err(e) => format!("ERROR: {e}"),
    }
}

fn sign_transaction_internal(private_key_hex: &str, message_hex: &str) -> Result<String, Box<dyn std::error::Error>> {
    let key_bytes = decode(private_key_hex.trim_start_matches("0x"))?;
    let signing_key = SigningKey::from_slice(&key_bytes)?;
    let msg_bytes = decode(message_hex.trim_start_matches("0x"))?;
    let signature: Signature = signing_key.sign(&msg_bytes);
    Ok(encode(signature.to_bytes()))
}

#[wasm_bindgen]
pub fn verify_signature(public_key_hex: &str, message_hex: &str, signature_hex: &str) -> String {
    console_error_panic_hook::set_once();
    match verify_signature_internal(public_key_hex, message_hex, signature_hex) {
        Ok(v)  => v.to_string(),
        Err(e) => format!("ERROR: {e}"),
    }
}

fn verify_signature_internal(public_key_hex: &str, message_hex: &str, signature_hex: &str) -> Result<bool, Box<dyn std::error::Error>> {
    let pk_bytes  = decode(public_key_hex)?;
    let vk = VerifyingKey::from_sec1_bytes(&pk_bytes)?;
    let msg = decode(message_hex)?;
    let sig = Signature::from_slice(&decode(signature_hex)?)?;
    Ok(vk.verify(&msg, &sig).is_ok())
}

#[wasm_bindgen]
pub fn generate_keypair() -> String {
    console_error_panic_hook::set_once();
    match generate_keypair_internal() {
        Ok((priv_k, pub_k)) => format!("{priv_k}|{pub_k}"),
        Err(e)              => format!("ERROR: {e}"),
    }
}

fn generate_keypair_internal() -> Result<(String, String), Box<dyn std::error::Error>> {
    let signing_key  = SigningKey::random(&mut rand::rngs::OsRng);
    let verifying_key = VerifyingKey::from(&signing_key);
    Ok((encode(signing_key.to_bytes()), encode(verifying_key.to_sec1_bytes())))
}

#[wasm_bindgen]
pub fn encrypt_data(plaintext: &str, key_hex: &str) -> String {
    console_error_panic_hook::set_once();
    match encrypt_data_internal(plaintext, key_hex) {
        Ok(s)  => s,
        Err(e) => format!("ERROR: {e}"),
    }
}

fn encrypt_data_internal(plaintext: &str, key_hex: &str) -> Result<String, Box<dyn std::error::Error>> {
    let key_bytes = decode(key_hex)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Invalid key: {e}"))?;
    let nonce_bytes = rand::random::<[u8; 12]>();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption failed: {e}"))?;
    let combined: Vec<u8> = nonce_bytes.iter().chain(ciphertext.iter()).copied().collect();
    Ok(general_purpose::STANDARD.encode(combined))
}

#[wasm_bindgen]
pub fn decrypt_data(encrypted_base64: &str, key_hex: &str) -> String {
    console_error_panic_hook::set_once();
    match decrypt_data_internal(encrypted_base64, key_hex) {
        Ok(s)  => s,
        Err(e) => format!("ERROR: {e}"),
    }
}

fn decrypt_data_internal(encrypted_base64: &str, key_hex: &str) -> Result<String, Box<dyn std::error::Error>> {
    let key_bytes = decode(key_hex)?;
    let cipher = Aes256Gcm::new_from_slice(&key_bytes)
        .map_err(|e| format!("Invalid key: {e}"))?;
    let combined = general_purpose::STANDARD.decode(encrypted_base64)?;
    if combined.len() < 12 { return Err("Invalid ciphertext: too short".into()); }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decryption failed: {e}"))?;
    Ok(String::from_utf8(plaintext)?)
}
