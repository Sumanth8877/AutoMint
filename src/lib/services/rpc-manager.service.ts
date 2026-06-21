import 'server-only';

import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient, http, type Account, type PublicClient, type WalletClient } from 'viem';
import { getCache, setCache } from '@/lib/redis';
import { getChain } from '@/lib/blockchain/chains';
import { addBreadcrumb, captureException, captureMessage } from '@/lib/observability/sentry';
import { getAllSettings } from '@/lib/services/integration-settings.service';
import { getRpcProviderSettings } from '@/lib/services/rpc-provider-settings.service';

export type RpcProvider = 'alchemy' | 'quicknode';
export type RpcRoutingMode = 'SMART' | 'MANUAL';
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
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 45;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 60_000;
const HEALTH_TTL_SECONDS = 24 * 60 * 60;
const publicClients = new Map<string, RpcClient>();
const walletClients = new Map<string, WalletClient>();

type RpcFailoverOptions = {
  providerOrder?: RpcProvider[];
  userId?: string;
  timeoutSeconds?: number;
  chain?: string;
};

type RpcEffectiveSettings = {
  routingMode: RpcRoutingMode;
  preferredProvider: RpcProvider | null;
  autoFailover: boolean;
  rpcTimeoutSeconds: number;
};

function normalizeChainName(chain: string) {
  getChain(chain);
  return chain.toLowerCase();
}

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

async function getAlchemyUrl(chain: string) {
  const chainName = normalizeChainName(chain);
  const settings = await getStoredIntegrationSettings();
  const apiKey = settings.ALCHEMY_API_KEY?.value || process.env.ALCHEMY_API_KEY;
  if (apiKey) {
    if (chainName === 'base') return `https://base-mainnet.g.alchemy.com/v2/${apiKey}`;
    if (chainName === 'polygon') return `https://polygon-mainnet.g.alchemy.com/v2/${apiKey}`;
    return `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
  }

  return process.env[`ALCHEMY_${chainName.toUpperCase()}_RPC_URL`] || process.env.ALCHEMY_RPC_URL;
}

async function getQuickNodeUrl(chain: string) {
  const chainName = normalizeChainName(chain);
  const settings = await getStoredIntegrationSettings();
  return settings.QUICKNODE_RPC_URL?.value
    || process.env[`QUICKNODE_${chainName.toUpperCase()}_RPC_URL`]
    || process.env.QUICKNODE_RPC_URL;
}

async function getProviderUrl(provider: RpcProvider, chain: string) {
  return provider === 'alchemy' ? getAlchemyUrl(chain) : getQuickNodeUrl(chain);
}

function getClientCacheKey(provider: RpcProvider, chain: string, url: string, timeoutSeconds: number, account?: string) {
  const urlHash = createHash('sha256').update(url).digest('hex').slice(0, 16);
  return [provider, chain, urlHash, timeoutSeconds, account].filter(Boolean).join(':');
}

async function getStoredIntegrationSettings() {
  try {
    return await getAllSettings();
  } catch (error) {
    logRpc('database integration settings unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
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

async function trackRpcAnalytics(input: {
  status: 'success' | 'failed' | 'failover';
  provider: RpcProvider;
  durationMs: number;
  metadata?: Record<string, unknown>;
}) {
  try {
    const { trackAnalyticsEvent } = await import('@/lib/services/analytics.service');
    await trackAnalyticsEvent({
      eventType: 'rpc',
      status: input.status,
      provider: input.provider,
      durationMs: input.durationMs,
      metadata: input.metadata,
    });
  } catch (error) {
    logRpc('analytics tracking skipped', {
      provider: input.provider,
      status: input.status,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeTimeoutSeconds(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_REQUEST_TIMEOUT_SECONDS;
  return Math.min(120, Math.max(5, value));
}

function toRpcProvider(value: string | null | undefined): RpcProvider | null {
  if (value === 'ALCHEMY') return 'alchemy';
  if (value === 'QUICKNODE') return 'quicknode';
  return null;
}

async function getEffectiveRpcSettings(userId?: string): Promise<RpcEffectiveSettings> {
  if (!userId) {
    return {
      routingMode: 'SMART',
      preferredProvider: null,
      autoFailover: true,
      rpcTimeoutSeconds: DEFAULT_REQUEST_TIMEOUT_SECONDS,
    };
  }

  try {
    const settings = await getRpcProviderSettings(userId);
    return {
      routingMode: settings.routingMode,
      preferredProvider: toRpcProvider(settings.preferredProvider),
      autoFailover: settings.autoFailover,
      rpcTimeoutSeconds: normalizeTimeoutSeconds(settings.rpcTimeoutSeconds),
    };
  } catch (error) {
    logRpc('rpc settings unavailable', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      routingMode: 'SMART',
      preferredProvider: null,
      autoFailover: true,
      rpcTimeoutSeconds: DEFAULT_REQUEST_TIMEOUT_SECONDS,
    };
  }
}

async function isProviderConfigured(provider: RpcProvider, chain: string) {
  return Boolean(await getProviderUrl(provider, chain));
}

function isHealthy(health: RpcHealth) {
  return !health.unhealthyUntil || health.unhealthyUntil <= Date.now();
}

function latencySortValue(health: RpcHealth) {
  return health.responseTime > 0 ? health.responseTime : Number.MAX_SAFE_INTEGER;
}

async function createClient(provider: RpcProvider, chainName: string, timeoutSeconds = DEFAULT_REQUEST_TIMEOUT_SECONDS) {
  const normalizedChain = normalizeChainName(chainName);
  const chain = getChain(normalizedChain);
  const url = await getProviderUrl(provider, normalizedChain);
  if (!url) throw new Error(`${provider} RPC is not configured for ${normalizedChain}`);

  const client = createPublicClient({
    chain,
    transport: http(url, { timeout: normalizeTimeoutSeconds(timeoutSeconds) * 1000 }),
  }) as RpcClient;

  return { client, cacheKey: getClientCacheKey(provider, normalizedChain, url, normalizeTimeoutSeconds(timeoutSeconds)) };
}

async function getProviderClient(provider: RpcProvider, chain: string, timeoutSeconds = DEFAULT_REQUEST_TIMEOUT_SECONDS) {
  const normalizedChain = normalizeChainName(chain);
  const normalizedTimeout = normalizeTimeoutSeconds(timeoutSeconds);
  const url = await getProviderUrl(provider, normalizedChain);
  if (!url) throw new Error(`${provider} RPC is not configured for ${normalizedChain}`);

  const key = getClientCacheKey(provider, normalizedChain, url, normalizedTimeout);
  const existing = publicClients.get(key);
  if (existing) return existing;

  const { client } = await createClient(provider, normalizedChain, normalizedTimeout);
  client.__provider = provider;
  publicClients.set(key, client);
  return client;
}

async function getProviderWalletClient(provider: RpcProvider, chainName: string, account: Account, timeoutSeconds = DEFAULT_REQUEST_TIMEOUT_SECONDS) {
  const normalizedChain = normalizeChainName(chainName);
  const normalizedTimeout = normalizeTimeoutSeconds(timeoutSeconds);
  const chain = getChain(normalizedChain);
  const url = await getProviderUrl(provider, normalizedChain);
  if (!url) throw new Error(`${provider} RPC is not configured for ${normalizedChain}`);

  const key = getClientCacheKey(provider, normalizedChain, url, normalizedTimeout, account.address);
  const existing = walletClients.get(key);
  if (existing) return existing;

  const client = createWalletClient({
    account,
    chain,
    transport: http(url, { timeout: normalizedTimeout * 1000 }),
  });
  walletClients.set(key, client);
  return client;
}

async function recordSuccess(provider: RpcProvider, responseTime: number) {
  await trackRpcAnalytics({
    status: 'success',
    provider,
    durationMs: responseTime,
  });
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
  await trackRpcAnalytics({
    status: 'failed',
    provider,
    durationMs: responseTime,
    metadata: { error: error instanceof Error ? error.message : String(error) },
  });
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
    await trackRpcAnalytics({
      status: 'failover',
      provider,
      durationMs: responseTime,
      metadata: { error: health.lastFailure, unhealthyUntil },
    });
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

async function getProviderOrder(options: RpcFailoverOptions = {}) {
  if (options.providerOrder?.length) return options.providerOrder;
  const normalizedChain = normalizeChainName(options.chain ?? 'ethereum');
  const settings = await getEffectiveRpcSettings(options.userId);
  const healthEntries = await Promise.all(PROVIDERS.map(async (provider) => ({
    provider,
    configured: await isProviderConfigured(provider, normalizedChain),
    health: await getHealth(provider),
  })));
  const configured = healthEntries.filter((entry) => entry.configured);
  const healthy = configured.filter((entry) => isHealthy(entry.health));

  if (settings.routingMode === 'MANUAL' && settings.preferredProvider) {
    const preferred = configured.find((entry) => entry.provider === settings.preferredProvider);
    if (!settings.autoFailover) return preferred ? [preferred.provider] : [settings.preferredProvider];
    const remaining = healthy
      .filter((entry) => entry.provider !== settings.preferredProvider)
      .sort((left, right) => latencySortValue(left.health) - latencySortValue(right.health))
      .map((entry) => entry.provider);
    return preferred ? [preferred.provider, ...remaining] : remaining;
  }

  const candidates = healthy.length > 0 ? healthy : configured;
  const sorted = candidates
    .sort((left, right) => latencySortValue(left.health) - latencySortValue(right.health))
    .map((entry) => entry.provider);

  return sorted.length > 0 ? sorted : PROVIDERS;
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
  options: RpcFailoverOptions = {},
) {
  const normalizedChain = normalizeChainName(chain);
  const providers = await getProviderOrder({ ...options, chain: normalizedChain });
  const settings = await getEffectiveRpcSettings(options.userId);
  const timeoutSeconds = normalizeTimeoutSeconds(options.timeoutSeconds ?? settings.rpcTimeoutSeconds);
  let lastError: unknown;

  for (const provider of providers) {
    try {
      if (provider === 'alchemy' && providers[0] !== 'alchemy') {
        const health = await getHealth('alchemy');
        if (health.unhealthyUntil && health.unhealthyUntil > Date.now()) continue;
      }

      logRpc('provider selected', { provider, chain: normalizedChain, operationName });
      return await executeWithRetries(provider, async (selectedProvider) => {
        const client = await getProviderClient(selectedProvider, normalizedChain, timeoutSeconds);
        return operation(client, selectedProvider);
      });
    } catch (error) {
      lastError = error;
      logRpc('failover triggered', {
        provider,
        nextProvider: provider === 'alchemy' ? 'quicknode' : null,
        chain: normalizedChain,
        operationName,
        error: error instanceof Error ? error.message : String(error),
      });
      await captureException(error, {
        area: 'rpc',
        level: 'warning',
        context: { provider, chain: normalizedChain, operationName },
        fingerprint: ['rpc', provider, operationName],
      });
      if (!settings.autoFailover) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('All RPC providers failed');
}

export function getPublicClient(chain: string, options: RpcFailoverOptions = {}): PublicClient {
  const normalizedChain = normalizeChainName(chain);

  return new Proxy({} as PublicClient, {
    get(_target, prop) {
      return (...args: unknown[]) => withRpcFailover(normalizedChain, String(prop), async (client) => {
        const value = (client as unknown as Record<PropertyKey, unknown>)[prop];
        if (typeof value !== 'function') return value as never;
        return await (value as (...methodArgs: unknown[]) => unknown).apply(client, args) as never;
      }, options);
    },
  });
}

export function getWalletClient(chain: string, account: Account, options: RpcFailoverOptions = {}): WalletClient {
  const normalizedChain = normalizeChainName(chain);

  return new Proxy({} as WalletClient, {
    get(_target, prop) {
      return (...args: unknown[]) => withRpcFailover(normalizedChain, String(prop), async (_client, provider) => {
        const settings = await getEffectiveRpcSettings(options.userId);
        const timeoutSeconds = normalizeTimeoutSeconds(options.timeoutSeconds ?? settings.rpcTimeoutSeconds);
        const walletClient = await getProviderWalletClient(provider, normalizedChain, account, timeoutSeconds);
        const value = (walletClient as unknown as Record<PropertyKey, unknown>)[prop];
        if (typeof value !== 'function') return value as never;
        return await (value as (...methodArgs: unknown[]) => unknown).apply(walletClient, args) as never;
      }, options);
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

export async function getRpcRoutingSnapshot(userId?: string, chain = 'ethereum') {
  const normalizedChain = normalizeChainName(chain);
  const [settings, health] = await Promise.all([
    getEffectiveRpcSettings(userId),
    getRpcHealthSnapshot(),
  ]);
  const providerOrder = await getProviderOrder({ userId, chain: normalizedChain });
  const providers = await Promise.all(PROVIDERS.map(async (provider) => {
    const providerHealth = health[provider];
    return {
      provider: provider === 'alchemy' ? 'ALCHEMY' as const : 'QUICKNODE' as const,
      configured: await isProviderConfigured(provider, normalizedChain),
      healthy: isHealthy(providerHealth),
      latency: providerHealth.responseTime > 0 ? providerHealth.responseTime : null,
      status: isHealthy(providerHealth) ? 'Healthy' as const : 'Unavailable' as const,
    };
  }));

  const active = providerOrder[0] ?? null;

  return {
    routingMode: settings.routingMode,
    preferredProvider: settings.preferredProvider === 'alchemy' ? 'ALCHEMY' as const : settings.preferredProvider === 'quicknode' ? 'QUICKNODE' as const : null,
    autoFailover: settings.autoFailover,
    rpcTimeoutSeconds: settings.rpcTimeoutSeconds,
    currentActiveProvider: active === 'alchemy' ? 'ALCHEMY' as const : active === 'quicknode' ? 'QUICKNODE' as const : null,
    providers,
  };
}

export async function refreshRpcProviderLatency(userId?: string, chain = 'ethereum') {
  const normalizedChain = normalizeChainName(chain);
  const settings = await getEffectiveRpcSettings(userId);
  const timeoutSeconds = normalizeTimeoutSeconds(settings.rpcTimeoutSeconds);

  await Promise.all(PROVIDERS.map(async (provider) => {
    if (!await isProviderConfigured(provider, normalizedChain)) return;

    const startedAt = Date.now();
    try {
      const client = await getProviderClient(provider, normalizedChain, timeoutSeconds);
      await client.getBlockNumber();
      await recordSuccess(provider, Date.now() - startedAt);
    } catch (error) {
      await recordFailure(provider, error, Date.now() - startedAt);
    }
  }));

  return getRpcRoutingSnapshot(userId, normalizedChain);
}
