import 'server-only';

import { createPublicClient, createWalletClient, http, type Account, type PublicClient, type WalletClient } from 'viem';
import { getCache, setCache } from '@/lib/redis';
import { getChain } from '@/lib/blockchain/chains';
import { addBreadcrumb, captureException, captureMessage } from '@/lib/observability/sentry';

type RpcProvider = 'alchemy' | 'quicknode';
type RpcHealth = {
  provider: RpcProvider;
  responseTime: number;
  errorCount: number;
  successCount: number;
  consecutiveFailures: number;
  lastFailure: string | null;
  unhealthyUntil: number | null;
  lastRestoredAt: string | null;
};

type RpcClient = PublicClient & {
  __provider?: RpcProvider;
};

const PROVIDERS: RpcProvider[] = ['alchemy', 'quicknode'];
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 250;
const REQUEST_TIMEOUT_MS = 12_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;
const HEALTH_TTL_SECONDS = 24 * 60 * 60;
const publicClients = new Map<string, RpcClient>();
const walletClients = new Map<string, WalletClient>();

function healthKey(provider: RpcProvider) {
  return `rpc:health:${provider}`;
}

function defaultHealth(provider: RpcProvider): RpcHealth {
  return {
    provider,
    responseTime: 0,
    errorCount: 0,
    successCount: 0,
    consecutiveFailures: 0,
    lastFailure: null,
    unhealthyUntil: null,
    lastRestoredAt: null,
  };
}

async function getHealth(provider: RpcProvider) {
  return (await getCache<RpcHealth>(healthKey(provider))) ?? defaultHealth(provider);
}

async function setHealth(health: RpcHealth) {
  await setCache(healthKey(health.provider), health, HEALTH_TTL_SECONDS);
}

function getAlchemyUrl(chain: string) {
  const specific = process.env[`ALCHEMY_${chain.toUpperCase()}_RPC_URL`];
  if (specific) return specific;

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) return process.env.ALCHEMY_RPC_URL;

  if (chain === 'base') return `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;
  if (chain === 'polygon') return `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`;
  return `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
}

function getQuickNodeUrl(chain: string) {
  return process.env[`QUICKNODE_${chain.toUpperCase()}_RPC_URL`]
    || process.env.QUICKNODE_RPC_URL;
}

function getProviderUrl(provider: RpcProvider, chain: string) {
  return provider === 'alchemy' ? getAlchemyUrl(chain) : getQuickNodeUrl(chain);
}

function isRetryableError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('timeout')
    || message.includes('timed out')
    || message.includes('429')
    || message.includes('rate limit')
    || message.includes('too many requests')
    || message.includes('500')
    || message.includes('502')
    || message.includes('503')
    || message.includes('504')
    || message.includes('network')
    || message.includes('fetch failed')
    || message.includes('econnreset')
    || message.includes('enotfound')
    || message.includes('etimedout');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logRpc(message: string, metadata: Record<string, unknown>) {
  console.log(`[RPC] ${message}`, metadata);
  addBreadcrumb({ category: 'rpc', message, level: 'info', data: metadata });
}

function createClient(provider: RpcProvider, chainName: string) {
  const chain = getChain(chainName);
  const url = getProviderUrl(provider, chainName);
  if (!url) throw new Error(`${provider} RPC is not configured for ${chainName}`);

  return createPublicClient({
    chain,
    transport: http(url, { timeout: REQUEST_TIMEOUT_MS }),
  }) as RpcClient;
}

function getProviderClient(provider: RpcProvider, chain: string) {
  const key = `${provider}:${chain}`;
  const existing = publicClients.get(key);
  if (existing) return existing;

  const client = createClient(provider, chain);
  client.__provider = provider;
  publicClients.set(key, client);
  return client;
}

function getProviderWalletClient(provider: RpcProvider, chainName: string, account: Account) {
  const chain = getChain(chainName);
  const url = getProviderUrl(provider, chainName);
  if (!url) throw new Error(`${provider} RPC is not configured for ${chainName}`);

  const key = `${provider}:${chainName}:${account.address}`;
  const existing = walletClients.get(key);
  if (existing) return existing;

  const client = createWalletClient({
    account,
    chain,
    transport: http(url, { timeout: REQUEST_TIMEOUT_MS }),
  });
  walletClients.set(key, client);
  return client;
}

async function recordSuccess(provider: RpcProvider, responseTime: number) {
  const previous = await getHealth(provider);
  const restored = previous.unhealthyUntil !== null || previous.consecutiveFailures > 0;
  const health = {
    ...previous,
    responseTime,
    successCount: previous.successCount + 1,
    consecutiveFailures: 0,
    unhealthyUntil: null,
    lastRestoredAt: restored ? new Date().toISOString() : previous.lastRestoredAt,
  };
  await setHealth(health);

  if (restored) {
    logRpc('provider restored', { provider, responseTime });
    await captureMessage('RPC provider restored', {
      area: 'rpc',
      level: 'info',
      context: { provider, responseTime },
    });
  }
}

async function recordFailure(provider: RpcProvider, error: unknown, responseTime: number) {
  const previous = await getHealth(provider);
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const unhealthyUntil = consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD
    ? Date.now() + CIRCUIT_OPEN_MS
    : previous.unhealthyUntil;
  const health = {
    ...previous,
    responseTime,
    errorCount: previous.errorCount + 1,
    consecutiveFailures,
    lastFailure: error instanceof Error ? error.message : String(error),
    unhealthyUntil,
  };
  await setHealth(health);

  if (consecutiveFailures === CIRCUIT_FAILURE_THRESHOLD) {
    logRpc('failover activation', { provider, unhealthyUntil });
    await captureMessage('RPC failover activation', {
      area: 'rpc',
      level: 'warning',
      context: { provider, unhealthyUntil },
      extra: { error: health.lastFailure },
      fingerprint: ['rpc', provider, 'failover'],
    });
  }
}

async function isCircuitOpen(provider: RpcProvider) {
  const health = await getHealth(provider);
  return Boolean(health.unhealthyUntil && health.unhealthyUntil > Date.now());
}

async function getProviderOrder() {
  if (await isCircuitOpen('alchemy')) return ['quicknode', 'alchemy'] as RpcProvider[];
  return PROVIDERS;
}

async function executeWithRetries<T>(
  provider: RpcProvider,
  operation: (provider: RpcProvider) => Promise<T>,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await operation(provider);
      await recordSuccess(provider, Date.now() - startedAt);
      return result;
    } catch (error) {
      lastError = error;
      await recordFailure(provider, error, Date.now() - startedAt);
      if (attempt >= MAX_RETRIES || !isRetryableError(error)) break;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export async function withRpcFailover<T>(
  chain: string,
  operationName: string,
  operation: (client: RpcClient, provider: RpcProvider) => Promise<T>,
) {
  const providers = await getProviderOrder();
  let lastError: unknown;

  for (const provider of providers) {
    try {
      if (provider === 'alchemy' && providers[0] !== 'alchemy') {
        const health = await getHealth('alchemy');
        if (health.unhealthyUntil && health.unhealthyUntil > Date.now()) continue;
      }

      logRpc('provider selected', { provider, chain, operationName });
      return await executeWithRetries(provider, async (selectedProvider) => {
        const client = getProviderClient(selectedProvider, chain);
        return operation(client, selectedProvider);
      });
    } catch (error) {
      lastError = error;
      logRpc('failover triggered', {
        provider,
        nextProvider: provider === 'alchemy' ? 'quicknode' : null,
        chain,
        operationName,
        error: error instanceof Error ? error.message : String(error),
      });
      await captureException(error, {
        area: 'rpc',
        level: 'warning',
        context: { provider, chain, operationName },
        fingerprint: ['rpc', provider, operationName],
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All RPC providers failed');
}

export function getPublicClient(chain: string): PublicClient {
  getChain(chain);

  return new Proxy({} as PublicClient, {
    get(_target, prop) {
      return (...args: unknown[]) => withRpcFailover(chain, String(prop), async (client) => {
        const value = (client as unknown as Record<PropertyKey, unknown>)[prop];
        if (typeof value !== 'function') return value as never;
        return await (value as (...methodArgs: unknown[]) => unknown).apply(client, args) as never;
      });
    },
  });
}

export function getWalletClient(chain: string, account: Account): WalletClient {
  getChain(chain);

  return new Proxy({} as WalletClient, {
    get(_target, prop) {
      return (...args: unknown[]) => withRpcFailover(chain, String(prop), async (_client, provider) => {
        const walletClient = getProviderWalletClient(provider, chain, account);
        const value = (walletClient as unknown as Record<PropertyKey, unknown>)[prop];
        if (typeof value !== 'function') return value as never;
        return await (value as (...methodArgs: unknown[]) => unknown).apply(walletClient, args) as never;
      });
    },
  });
}

export async function getRpcHealthSnapshot() {
  const [alchemy, quicknode] = await Promise.all([
    getHealth('alchemy'),
    getHealth('quicknode'),
  ]);

  return { alchemy, quicknode };
}
