import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { sql } from 'drizzle-orm';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getChain } from '@/lib/blockchain/chains';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import { captureMessage } from '@/lib/observability/sentry';

type IntegrationName =
  | 'Alchemy'
  | 'QuickNode'
  | 'Jina'
  | 'Firecrawl'
  | 'Browserbase'
  | 'QStash'
  | 'Sentry'
  | 'Database'
  | 'Redis'
  | 'Clerk';

type IntegrationStatus = 'UNKNOWN' | 'PASS' | 'FAIL';

type IntegrationResult = {
  name: IntegrationName;
  configured: boolean;
  source: 'Environment';
  status: IntegrationStatus;
  latency: number | null;
  error: string | null;
  lastTestedAt: string | null;
};

const INTEGRATIONS: Array<{
  name: IntegrationName;
  configured: () => boolean;
}> = [
  { name: 'Alchemy', configured: () => Boolean(process.env.ALCHEMY_API_KEY) },
  { name: 'QuickNode', configured: () => Boolean(process.env.QUICKNODE_RPC_URL) },
  { name: 'Jina', configured: () => Boolean(process.env.JINA_API_KEY || process.env.JINA_READER_API_KEY) },
  { name: 'Firecrawl', configured: () => Boolean(process.env.FIRECRAWL_API_KEY) },
  { name: 'Browserbase', configured: () => Boolean(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID) },
  { name: 'QStash', configured: () => Boolean(process.env.QSTASH_TOKEN) },
  { name: 'Sentry', configured: () => Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) },
  { name: 'Database', configured: () => Boolean(process.env.DATABASE_URL) },
  { name: 'Redis', configured: () => Boolean((process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) || (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)) },
  { name: 'Clerk', configured: () => Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY) },
];

function baseResult(name: IntegrationName): IntegrationResult {
  const integration = INTEGRATIONS.find((item) => item.name === name);

  return {
    name,
    configured: integration?.configured() ?? false,
    source: 'Environment',
    status: 'UNKNOWN',
    latency: null,
    error: null,
    lastTestedAt: null,
  };
}

function getSecretValues() {
  const names = [
    'DATABASE_URL',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'QSTASH_TOKEN',
    'ALCHEMY_API_KEY',
    'QUICKNODE_RPC_URL',
    'QUICKNODE_WSS_URL',
    'JINA_API_KEY',
    'JINA_READER_API_KEY',
    'FIRECRAWL_API_KEY',
    'BROWSERBASE_API_KEY',
    'BROWSERBASE_PROJECT_ID',
    'SENTRY_DSN',
    'NEXT_PUBLIC_SENTRY_DSN',
  ];

  return names
    .map((name) => process.env[name])
    .filter((value): value is string => Boolean(value && value.length >= 4));
}

function sanitizeError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);

  for (const secret of getSecretValues()) {
    message = message.split(secret).join('[redacted]');
  }

  return message;
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function createEthereumClient(url: string) {
  return createPublicClient({
    chain: getChain('ethereum'),
    transport: http(url, { timeout: 12_000 }),
  });
}

async function runTest(name: IntegrationName, action: () => Promise<void>): Promise<IntegrationResult> {
  const startedAt = Date.now();
  const testedAt = new Date().toISOString();
  const result = baseResult(name);

  try {
    await action();
    return {
      ...result,
      status: 'PASS',
      latency: Date.now() - startedAt,
      lastTestedAt: testedAt,
    };
  } catch (error) {
    return {
      ...result,
      status: 'FAIL',
      latency: Date.now() - startedAt,
      error: sanitizeError(error),
      lastTestedAt: testedAt,
    };
  }
}

function buildSummary(results: IntegrationResult[]) {
  const healthy = results.filter((result) => result.status === 'PASS').length;
  const failing = results.filter((result) => result.status === 'FAIL').length;
  const score = results.length > 0 ? Math.round((healthy / results.length) * 100) : 0;

  return {
    healthyServices: healthy,
    failingServices: failing,
    overallInfrastructureScore: score,
  };
}

async function testDatabase() {
  return runTest('Database', async () => {
    await getDb().execute(sql`SELECT 1`);
  });
}

async function testRedis() {
  return runTest('Redis', async () => {
    const client = getRedisClient();
    const key = `integration-status:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const value = `ok:${Date.now()}`;

    await client.set(key, value, { ex: 60 });
    const stored = await client.get<string>(key);
    await client.del(key);

    if (stored !== value) throw new Error('Redis set/get/delete check failed');
  });
}

async function testAlchemy() {
  return runTest('Alchemy', async () => {
    const apiKey = requireEnv('ALCHEMY_API_KEY');
    await createEthereumClient(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`).getBlockNumber();
  });
}

async function testQuickNode() {
  return runTest('QuickNode', async () => {
    await createEthereumClient(requireEnv('QUICKNODE_RPC_URL')).getBlockNumber();
  });
}

async function testJina() {
  return runTest('Jina', async () => {
    const token = process.env.JINA_API_KEY || process.env.JINA_READER_API_KEY;
    const headers: Record<string, string> = { Accept: 'text/plain' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch('https://r.jina.ai/http://example.com', {
      headers,
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) throw new Error(`Jina URL extraction failed with status ${response.status}`);

    const text = await response.text();
    if (text.trim().length < 20) throw new Error('Jina URL extraction returned an empty response');
  });
}

async function testFirecrawl() {
  return runTest('Firecrawl', async () => {
    const apiKey = requireEnv('FIRECRAWL_API_KEY');
    const baseUrl = (process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/v1/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://example.com',
        formats: ['markdown'],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Firecrawl authenticated request failed with status ${response.status}`);
    }
    if (!response.ok) throw new Error(`Firecrawl request failed with status ${response.status}`);
  });
}

async function testBrowserbase() {
  return runTest('Browserbase', async () => {
    requireEnv('BROWSERBASE_API_KEY');
    requireEnv('BROWSERBASE_PROJECT_ID');
  });
}

async function testQStash() {
  return runTest('QStash', async () => {
    requireEnv('QSTASH_TOKEN');
  });
}

async function testSentry() {
  return runTest('Sentry', async () => {
    requireEnv(process.env.SENTRY_DSN ? 'SENTRY_DSN' : 'NEXT_PUBLIC_SENTRY_DSN');
    const eventId = await captureMessage('Integration status test event', {
      area: 'integration-status',
      tags: { integration: 'sentry' },
      fingerprint: ['integration-status', 'sentry'],
    });
    if (!eventId) throw new Error('Sentry test event was not accepted');
  });
}

async function testClerk() {
  return runTest('Clerk', async () => {
    requireEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
    requireEnv('CLERK_SECRET_KEY');
  });
}

async function testAllIntegrations() {
  const results = await Promise.all([
    testAlchemy(),
    testQuickNode(),
    testJina(),
    testFirecrawl(),
    testBrowserbase(),
    testQStash(),
    testSentry(),
    testDatabase(),
    testRedis(),
    testClerk(),
  ]);

  return {
    integrations: results,
    summary: buildSummary(results),
  };
}

function getUnknownIntegrations() {
  const integrations = INTEGRATIONS.map((integration) => baseResult(integration.name));

  return {
    integrations,
    summary: buildSummary(integrations),
  };
}

export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  return NextResponse.json(getUnknownIntegrations());
}

export async function POST() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  return NextResponse.json(await testAllIntegrations());
}
