'use client';

// H-05 Fix: signTransactionWasm is intentionally NOT exposed from this hook.
//
// Signing transactions requires a private key. Passing a raw private key hex
// string through a React hook means it lives in JS heap memory in the browser,
// is accessible to any XSS payload, and may be captured by browser devtools,
// React DevTools, or error tracking SDKs.
//
// All transaction signing happens server-side inside executeMint()
// (src/lib/blockchain/mint.ts), which decrypts keys from the server-side
// AES-256-GCM vault (src/lib/security/encryption.ts) and never exposes
// the plaintext to the client.
//
// This hook exposes only operations that are safe to run client-side:
//   hashMessage    — message hashing (no secret material)
//   verifySignature — signature verification (only public key + sig, no privkey)
//
// If you need to add a new WASM capability, verify it requires no secret
// material before adding it here.

import { useState, useCallback, useEffect } from 'react';
import { initializeWasmCrypto, hashMessageWasm, verifySignatureWasm } from '@/lib/wasm/crypto';

export function useWasmCrypto() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<Error | null>(null);

  useEffect(() => {
    async function init() {
      if (isInitializing) return;
      setIsInitializing(true);
      try {
        await initializeWasmCrypto();
        setIsInitialized(true);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setInitError(err);
        console.error('Failed to initialize WASM crypto:', err);
      } finally {
        setIsInitializing(false);
      }
    }
    init();
  }, [isInitializing]);

  // Safe: hashes a string — no secret material involved.
  const hashMessage = useCallback(async (message: string) => {
    if (!isInitialized) throw new Error('WASM crypto not initialized');
    return hashMessageWasm(message);
  }, [isInitialized]);

  // Safe: verifies a signature — requires only public key + signature, no private key.
  const verifySignature = useCallback(
    async (publicKeyHex: string, messageHex: string, signatureHex: string) => {
      if (!isInitialized) throw new Error('WASM crypto not initialized');
      return verifySignatureWasm(publicKeyHex, messageHex, signatureHex);
    },
    [isInitialized],
  );

  return {
    isInitialized,
    isInitializing,
    initError,
    hashMessage,
    verifySignature,
    // signTransaction is deliberately NOT exported.
    // See the security note at the top of this file.
  };
}
