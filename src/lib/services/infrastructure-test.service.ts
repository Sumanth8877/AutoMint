import 'server-only';

import { eq, sql } from 'drizzle-orm';
import { createPublicClient, formatEther, http, type PublicClient } from 'viem';
import { infrastructureTestRuns } from '@/drizzle/schema';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import { getChain } from '@/lib/blockchain/chains';
import { withRpcFailover } from '@/lib/services/rpc-manager.service';
import { isTelegramEnabled, sendTelegramMessage } from '@/lib/services/telegram.service';
import { discoverWithJina } from '@/lib/services/jina.provider';
import { discoverWithFirecrawl } from '@/lib/services/firecrawl.provider';
import { captureException } from '@/lib/observability/sentry';

export type InfrastructureTestStatus = 'passed' | 'failed' | 'warning' | 'skipped';
export type InfrastructureService =
  | 'Telegram'
  | 'Redis'
  | 'QStash'
  | 'Database'
  | 'Alchemy'
  | 'QuickNode'
  | 'RPC Failover'
  | 'Jina'
  | 'Firecrawl'
  | 'Sentry';

export type InfrastructureTestResult = {
  service: InfrastructureService;
  status: InfrastructureTestStatus;
  score: number;
  latency: number;
  summary: string;
  reasoning: string;
  rootCause: string;
  fixRecommendation: string;
  response: Record<string, unknown>;
  testedAt: Date;
};

const TEST_URL = 'https://opensea.io/collection/azuki';
const TEST_WALLET = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const QSTASH_BASE_URL = 'https://qstash.upstash.io';
const ETHEREUM_CHAIN_ID = 1;

function serviceScore(status: InfrastructureTestStatus, latency: number) {
  if (status === 'skipped') return 100;
  if (status === 'failed') return 20;
  if (status === 'warning') return latency > 15_000 ? 70 : 85;
  if (latency > 10_000) return 92;
  if (latency > 5_000) return 96;
  return 100;
}

function warningIfSlow(latency: number, threshold = 12_000): InfrastructureTestStatus {
  return latency > threshold ? 'warning' : 'passed';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function rootCauseFor(service: InfrastructureService, message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('not configured') || lower.includes('must be set') || lower.includes('required')) {
    return `${service} environment configuration is missing.`;
  }
  if (lower.includes('401') || lower.includes('unauthorized')) return `Invalid ${service} API credentials.`;
  if (lower.includes('403') || lower.includes('forbidden')) return `${service} credentials do not have permission for this operation.`;
  if (lower.includes('429') || lower.includes('rate limit')) return `${service} rate limit was reached.`;
  if (lower.includes('timeout') || lower.includes('timed out')) return `${service} request timed out.`;
  return `${service} returned an unexpected integration error.`;
}

function recommendationFor(service: InfrastructureService, message: string) {
  const lower = message.toLowerCase();
  if (lower.includes('not configured') || lower.includes('must be set') || lower.includes('required')) {
    return `Verify the ${service} environment variables are present in this deployment.`;
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('403') || lower.includes('forbidden')) {
    return `Rotate or re-enter the ${service} API key/token and confirm account permissions.`;
  }
  if (lower.includes('429') || lower.includes('rate limit')) return `Reduce request volume or raise the ${service} rate limit.`;
  if (lower.includes('timeout') || lower.includes('timed out')) return `Check ${service} status and network latency from the deployment region.`;
  return `Inspect ${service} credentials, service status, and recent deployment environment changes.`;
}

async function executeTest(
  service: InfrastructureService,
  action: () => Promise<Record<string, unknown>>,
  successSummary: string,
) {
  const startedAt = Date.now();
  try {
    const response = await action();
    const latency = Date.now() - startedAt;
    const status = warningIfSlow(latency);
    const score = serviceScore(status, latency);
    return {
      service,
      status,
      score,
      latency,
      summary: status === 'passed' ? successSummary : `${service} succeeded with elevated latency.`,
      reasoning: status === 'passed'
        ? `${service} completed the required real integration checks.`
        : `${service} returned a valid response, but latency was ${latency}ms.`,
      rootCause: status === 'passed' ? 'No issue detected.' : `${service} is reachable but slower than expected.`,
      fixRecommendation: status === 'passed'
        ? 'No action required.'
        : `Monitor ${service} latency and check provider status if this repeats.`,
      response,
      testedAt: new Date(),
    } satisfies InfrastructureTestResult;
  } catch (error) {
    const latency = Date.now() - startedAt;
    const message = getErrorMessage(error);
    await captureException(error, {
      area: 'infrastructure-test',
      context: { provider: service, durationMs: latency },
      fingerprint: ['infrastructure-test', service],
      extra: { service },
    });
    return {
      service,
      status: 'failed',
      score: serviceScore('failed', latency),
      latency,
      summary: `${service} request failed.`,
      reasoning: message,
      rootCause: rootCauseFor(service, message),
      fixRecommendation: recommendationFor(service, message),
      response: { error: message },
      testedAt: new Date(),
    } satisfies InfrastructureTestResult;
  }
}

function getAdminChatId() {
  const chatId = (process.env.ADMIN_TELEGRAM_CHAT_IDS || process.env.ADMIN_TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean);
  if (!chatId) throw new Error('ADMIN_TELEGRAM_CHAT_ID or ADMIN_TELEGRAM_CHAT_IDS is not configured');
  return chatId;
}

function getQStashToken() {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new Error('QSTASH_TOKEN is not configured');
  return token;
}

function getQStashProbeUrl() {
  const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!baseUrl) throw new Error('APP_URL, NEXT_PUBLIC_APP_URL, or VERCEL_URL is required for QStash schedule validation');
  return `${baseUrl.replace(/\/$/, '')}/api/admin/testing/infrastructure/qstash-probe`;
}

function getProviderUrl(provider: 'alchemy' | 'quicknode', chain: string) {
  if (provider === 'alchemy') {
    const specific = process.env[`ALCHEMY_${chain.toUpperCase()}_RPC_URL`];
    if (specific) return specific;
    if (process.env.ALCHEMY_API_KEY) {
      if (chain === 'base') return `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
      if (chain === 'polygon') return `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
      return `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
    }
    return process.env.ALCHEMY_RPC_URL;
  }

  return process.env[`QUICKNODE_${chain.toUpperCase()}_RPC_URL`] || process.env.QUICKNODE_RPC_URL;
}

function createDirectRpcClient(provider: 'alchemy' | 'quicknode') {
  const url = getProviderUrl(provider, 'ethereum');
  if (!url) throw new Error(`${provider} RPC is not configured for ethereum`);
  return createPublicClient({
    chain: getChain('ethereum'),
    transport: http(url, { timeout: 12_000 }),
  });
}

async function testDirectRpc(provider: 'alchemy' | 'quicknode') {
  const client = createDirectRpcClient(provider);
  const [chainId, blockNumber, balance] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getBalance({ address: TEST_WALLET }),
  ]);
  if (chainId !== ETHEREUM_CHAIN_ID) {
    throw new Error(`${provider} RPC returned chain id ${chainId}; expected Ethereum mainnet (${ETHEREUM_CHAIN_ID})`);
  }
  return {
    chain: 'ethereum',
    chainId,
    blockNumber: blockNumber.toString(),
    wallet: TEST_WALLET,
    balance: formatEther(balance),
    provider,
  };
}

export async function testTelegram() {
  if (!isTelegramEnabled()) {
    return {
      service: 'Telegram',
      status: 'skipped',
      score: 100,
      latency: 0,
      summary: 'Telegram Status: Disabled',
      reasoning: 'Telegram disabled by configuration',
      rootCause: 'No issue detected. Telegram is optional and disabled.',
      fixRecommendation: 'Set TELEGRAM_ENABLED=true, TELEGRAM_BOT_TOKEN, and ADMIN_TELEGRAM_CHAT_ID to enable Telegram.',
      response: { enabled: false },
      testedAt: new Date(),
    } satisfies InfrastructureTestResult;
  }

  return executeTest('Telegram', async () => {
    const result = await sendTelegramMessage(getAdminChatId(), 'Infrastructure Test - Telegram OK');
    if (!result.message_id) throw new Error('Telegram API succeeded but did not return message_id');
    return { messageId: result.message_id };
  }, 'Telegram delivered the infrastructure test message.');
}

export async function testRedis() {
  return executeTest('Redis', async () => {
    const redis = getRedisClient();
    const key = 'test:infrastructure';
    const value = `ok:${Date.now()}`;
    await redis.set(key, value);
    const stored = await redis.get<string>(key);
    if (stored !== value) throw new Error('Redis GET did not return the value written by SET');
    const deleted = await redis.del(key);
    const afterDelete = await redis.get(key);
    if (deleted < 1 || afterDelete !== null) throw new Error('Redis DEL did not remove the test key');
    return { key, stored, deleted };
  }, 'Redis set/get/delete operations succeeded.');
}

export async function testQStash() {
  return executeTest('QStash', async () => {
    const destination = getQStashProbeUrl();
    const headers = {
      Authorization: `Bearer ${getQStashToken()}`,
      'Content-Type': 'application/json',
      'Upstash-Cron': '0 0 1 1 *',
    };
    const createResponse = await fetch(`${QSTASH_BASE_URL}/v2/schedules/${encodeURIComponent(destination)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'infrastructure_probe', createdAt: new Date().toISOString() }),
    });
    const createText = await createResponse.text();
    if (!createResponse.ok) throw new Error(createText || `QStash create schedule failed with status ${createResponse.status}`);
    const created = JSON.parse(createText || '{}') as { scheduleId?: string };
    if (!created.scheduleId) throw new Error('QStash schedule response did not include scheduleId');

    const verifyResponse = await fetch(`${QSTASH_BASE_URL}/v2/schedules/${encodeURIComponent(created.scheduleId)}`, {
      headers: { Authorization: `Bearer ${getQStashToken()}` },
    });
    const verifyText = await verifyResponse.text();
    if (!verifyResponse.ok) throw new Error(verifyText || `QStash verify schedule failed with status ${verifyResponse.status}`);

    const cancelResponse = await fetch(`${QSTASH_BASE_URL}/v2/schedules/${encodeURIComponent(created.scheduleId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getQStashToken()}` },
    });
    const cancelText = await cancelResponse.text();
    if (!cancelResponse.ok && cancelResponse.status !== 404) {
      throw new Error(cancelText || `QStash cancel schedule failed with status ${cancelResponse.status}`);
    }

    return { scheduleId: created.scheduleId, destination, verified: true, cancelled: true };
  }, 'QStash schedule create, verify, and cancel succeeded.');
}

export async function testDatabase() {
  return executeTest('Database', async () => {
    await getDb().execute(sql`SELECT 1`);
    const [created] = await getDb().insert(infrastructureTestRuns).values({
      service: 'database-crud-temp',
      status: 'warning',
      score: 1,
      latency: 0,
      summary: 'Temporary database CRUD validation row.',
      reasoning: 'Created by infrastructure database test.',
      rootCause: 'Temporary row.',
      fixRecommendation: 'Temporary row.',
      response: { temp: true },
    }).returning();
    if (!created) throw new Error('Database create did not return a row');

    const [read] = await getDb().select().from(infrastructureTestRuns).where(eq(infrastructureTestRuns.id, created.id)).limit(1);
    if (!read) throw new Error('Database read did not find the temporary row');

    const [updated] = await getDb()
      .update(infrastructureTestRuns)
      .set({ score: 2, summary: 'Updated temporary database CRUD validation row.' })
      .where(eq(infrastructureTestRuns.id, created.id))
      .returning();
    if (!updated || updated.score !== 2) throw new Error('Database update did not persist');

    const [deleted] = await getDb().delete(infrastructureTestRuns).where(eq(infrastructureTestRuns.id, created.id)).returning();
    if (!deleted) throw new Error('Database delete did not return the temporary row');
    return { created: created.id, read: read.id, updated: updated.id, deleted: deleted.id };
  }, 'Database CRUD validation succeeded.');
}

export async function testAlchemy() {
  return executeTest('Alchemy', () => testDirectRpc('alchemy'), 'Alchemy latest block and wallet balance requests succeeded.');
}

export async function testQuickNode() {
  return executeTest('QuickNode', () => testDirectRpc('quicknode'), 'QuickNode latest block and wallet balance requests succeeded.');
}

export async function testRpcFailover() {
  return executeTest('RPC Failover', async () => {
    const ethereum = getChain('Ethereum');
    if (ethereum.id !== ETHEREUM_CHAIN_ID) {
      throw new Error(`Chain mapping returned ${ethereum.id}; expected Ethereum mainnet (${ETHEREUM_CHAIN_ID})`);
    }

    const attempts: Array<'alchemy' | 'quicknode'> = [];
    const result = await withRpcFailover('ethereum', 'infrastructureFailoverProbe', async (client: PublicClient, provider) => {
      attempts.push(provider);
      if (provider === 'alchemy') throw new Error('Simulated Alchemy unavailable');
      const [chainId, blockNumber, balance] = await Promise.all([
        client.getChainId(),
        client.getBlockNumber(),
        client.getBalance({ address: TEST_WALLET }),
      ]);
      if (chainId !== ETHEREUM_CHAIN_ID) {
        throw new Error(`Failover RPC returned chain id ${chainId}; expected Ethereum mainnet (${ETHEREUM_CHAIN_ID})`);
      }
      return {
        handledBy: provider,
        chain: 'ethereum',
        chainId,
        blockNumber: blockNumber.toString(),
        wallet: TEST_WALLET,
        balance: formatEther(balance),
      };
    }, { providerOrder: ['alchemy', 'quicknode'] });
    if (attempts[0] !== 'alchemy') throw new Error('RPC manager did not select Alchemy first for the forced failover probe');
    if (result.handledBy !== 'quicknode') throw new Error('RPC failover did not route to QuickNode');
    return { ...result, attempts };
  }, 'RPC failover routed the request to QuickNode after simulated Alchemy failure.');
}

export async function testJina() {
  return executeTest('Jina', async () => {
    const result = await discoverWithJina(TEST_URL);
    const size = result.rawText?.length ?? 0;
    if (size < 100) throw new Error('Jina returned an empty or too-small extraction response');
    return {
      url: TEST_URL,
      responseSize: size,
      collectionName: result.collectionName,
      contract: result.contract,
    };
  }, 'Jina extracted content from the OpenSea collection URL.');
}

export async function testFirecrawl() {
  return executeTest('Firecrawl', async () => {
    const result = await discoverWithFirecrawl(TEST_URL);
    const size = result.rawText?.length ?? 0;
    if (size < 100) throw new Error('Firecrawl returned an empty or too-small crawl response');
    return {
      url: TEST_URL,
      responseSize: size,
      collectionName: result.collectionName,
      contract: result.contract,
    };
  }, 'Firecrawl crawled content from the OpenSea collection URL.');
}

export async function testSentry() {
  return executeTest('Sentry', async () => {
    const eventId = await captureException(new Error('InfrastructureTestException'), {
      area: 'infrastructure-test',
      tags: { test: 'sentry' },
      fingerprint: ['infrastructure-test', 'sentry'],
    });
    if (!eventId) throw new Error('Sentry did not accept the test exception or no event id was returned');
    return { eventId };
  }, 'Sentry accepted the real test exception.');
}

export async function runInfrastructureServiceTests() {
  return Promise.all([
    testTelegram(),
    testRedis(),
    testQStash(),
    testDatabase(),
    testAlchemy(),
    testQuickNode(),
    testRpcFailover(),
    testJina(),
    testFirecrawl(),
    testSentry(),
  ]);
}
