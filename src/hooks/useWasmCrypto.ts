'use client';

import { useState, useCallback, useEffect } from 'react';
import { initializeWasmCrypto, signTransactionWasm, hashMessageWasm } from '@/lib/wasm/crypto';

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

  const signTransaction = useCallback(async (privateKeyHex: string, messageHex: string) => {
    if (!isInitialized) {
      throw new Error('WASM crypto not initialized');
    }
    return signTransactionWasm(privateKeyHex, messageHex);
  }, [isInitialized]);

  const hashMessage = useCallback(async (message: string) => {
    if (!isInitialized) {
      throw new Error('WASM crypto not initialized');
    }
    return hashMessageWasm(message);
  }, [isInitialized]);

  return {
    isInitialized,
    isInitializing,
    initError,
    signTransaction,
    hashMessage,
  };
}
