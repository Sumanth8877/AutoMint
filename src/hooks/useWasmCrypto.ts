'use client';

import { useState, useCallback, useEffect } from 'react';
import { initializeWasmCrypto, signTransactionWasm, hashMessageWasm } from '@/lib/wasm/crypto';

export function useWasmCrypto() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  useEffect(() => {
    async function init() {
      if (isInitializing) return;
      setIsInitializing(true);
      try {
        await initializeWasmCrypto();
        setIsInitialized(true);
      } catch (error) {
        console.error('Failed to initialize WASM crypto:', error);
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
    signTransaction,
    hashMessage,
  };
}
