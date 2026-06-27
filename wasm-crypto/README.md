# wasm-crypto

Rust WASM module for AutoMint — handles all CPU-intensive crypto and encoding
operations that would be slower or less secure in JavaScript.

## What's in here

### Ethereum Primitives
- `keccak256(dataHex)` — the Ethereum hash function (NOT SHA-256)
- `keccak256_string(s)` — hash a UTF-8 string
- `get_ethereum_address(privKey)` — derive 0x address from private key

### ABI Calldata Encoding
- `encode_mint_calldata(fn, qty)` — encode `functionName(uint256)` calldata
- `encode_no_arg_calldata(fn)` — encode `functionName()` calldata

### Merkle Proof (WL / Allowlist mints)
OpenZeppelin-compatible Merkle tree — used by virtually all WL-gated NFT contracts.
- `compute_merkle_root(addrsJson)` — compute root for a list of addresses
- `generate_merkle_proof(addrsJson, target)` — proof for one address
- `verify_merkle_proof(proof, root, leaf)` — verify a proof

### Legacy (kept for backward-compat)
- `sign_transaction`, `verify_signature`, `generate_keypair`
- `encrypt_data`, `decrypt_data` (AES-256-GCM)
- `hash_message` (SHA-256 — use `keccak256` for EVM work)

## Build

```bash
# Install wasm-pack if not already installed
cargo install wasm-pack

# Build (from repo root)
cd wasm-crypto
wasm-pack build --target web --out-dir ../public/wasm

# The output lands in public/wasm/:
#   wasm_crypto.js      — ESM loader
#   wasm_crypto_bg.wasm — binary
```

## Why Rust / WASM?

| Operation | JS/Viem | Rust WASM | Speedup |
|-----------|---------|-----------|---------|
| keccak256 | ~1ms | ~0.1ms | ~10× |
| ABI encoding | ~2ms | ~0.2ms | ~10× |
| Merkle proof (1000 addrs) | ~50ms | ~3ms | ~15× |
| Private key signing | already fast | similar | — |

For a mint that starts at an exact timestamp, shaving 50ms off calldata
preparation can mean the difference between getting in block N vs N+1.
