import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { sql } from 'drizzle-orm';
import { Redis } from '@upstash/redis';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getChain } from '@/lib/blockchain/chains';
import { getDb } from '@/lib/db';

type KnownService =
  | 'Alchemy'
  | 'Infura'
  | 'Chainstack'
  | 'Firecrawl'
  | 'QStash'
  | 'Database'
  | 'Redis'
  | 'Clerk';

type IntegrationStatus = 'UNKNOWN' | 'PASS' | 'FAIL';

type IntegrationVariable = {
  variableName: string;
  serviceName: string;
  configured: boolean;
  source: 'Environment';
  status: IntegrationStatus;
  latency: number | null;
  error: string | null;
  lastTestedAt: string | null;
};

type ServiceTestResult = {
  serviceName: KnownService;
  status: 'PASS' | 'FAIL';
  latency: number;
  error: string | null;
  lastTestedAt: string;
};

const KNOWN_VARIABLES: Array<{ variableName: string; serviceName: KnownService }> = [
  { variableName: 'ALCHEMY_API_KEY', serviceName: 'Alchemy' },
  { variableName: 'INFURA_API_KEY', serviceName: 'Infura' },
  { variableName: 'CHAINSTACK_API_KEY', serviceName: 'Chainstack' },
  { variableName: 'FIRECRAWL_API_KEY', serviceName: 'Firecrawl' },
  { variableName: 'QSTASH_TOKEN', serviceName: 'QStash' },
  { variableName: 'QSTASH_CURRENT_SIGNING_KEY', serviceName: 'QStash' },
  { variableName: 'QSTASH_NEXT_SIGNING_KEY', serviceName: 'QStash' },
  { variableName: 'DATABASE_URL', serviceName: 'Database' },
  { variableName: 'KV_REST_API_URL', serviceName: 'Redis' },
  { variableName: 'KV_REST_API_TOKEN', serviceName: 'Redis' },
  { variableName: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', serviceName: 'Clerk' },
  { variableName: 'CLERK_SECRET_KEY', serviceName: 'Clerk' },
];

const SERVICE_KEYWORDS: Array<[string, KnownService]> = [
  ['ALCHEMY', 'Alchemy'],
  ['FIRECRAWL', 'Firecrawl'],
  ['QSTASH', 'QStash'],
  ['DATABASE', 'Database'],
  ['REDIS', 'Redis'],
  ['KV_REST', 'Redis'],
  ['CLERK', 'Clerk'],
];

const SERVICE_DISCOVERY_PATTERN = /(ALCHEMY|FIRECRAWL|QSTASH|CLERK|REDIS|KV_REST)/;
const GENERIC_SERVICE_SECRET_PATTERN = /^[A-Z][A-Z0-9_]+_(API_KEY|RPC_URL|WSS_URL|DSN)$/;
const IGNORED_PREFIXES = [
  'npm_',
  'npm_config_',
  'AWS_',
  'VERCEL_',
  'NODE_',
  'PG',
  'POSTGRES_',
  'NEON_',
  'VITE_',
  'PROCESSOR_',
  'ProgramFiles',
  'CommonProgramFiles',
];
const IGNORED_NAMES = new Set([
  'ALLUSERSPROFILE',
  'APPDATA',
  'COMPUTERNAME',
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'NODE_ENV',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PWD',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'DATABASE_URL_UNPOOLED',
  'ENCRYPTION_KEY',
  'FIRECRAWL_API_URL',
  'KV_URL',
  'QSTASH_WEBHOOK_URL',
  'REDIS_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'WINDIR',
]);

function inferServiceName(variableName: string) {
  const upper = variableName.toUpperCase();
  const known = KNOWN_VARIABLES.find((item) => item.variableName === variableName);
  if (known) return known.serviceName;

  const matched = SERVICE_KEYWORDS.find(([keyword]) => upper.includes(keyword));
  if (matched) return matched[1];

  const base = variableName
    .replace(/^NEXT_PUBLIC_/, '')
    .replace(/_(API|KEY|TOKEN|SECRET|URL|URI|DSN|RPC|WSS|WEBHOOK).*$/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');

  return base || 'Environment';
}

function shouldSurfaceVariable(variableName: string) {
  if (KNOWN_VARIABLES.some((item) => item.variableName === variableName)) return true;
  if (IGNORED_NAMES.has(variableName)) return false;
  if (IGNORED_PREFIXES.some((prefix) => variableName.startsWith(prefix))) return false;
  const upper = variableName.toUpperCase();
  return SERVICE_DISCOVERY_PATTERN.test(upper) || GENERIC_SERVICE_SECRET_PATTERN.test(upper);
}

function getDiscoveredVariableNames() {
  const names = new Set<string>();

  for (const item of KNOWN_VARIABLES) {
    names.add(item.variableName);
  }

  for (const name of Object.keys(process.env)) {
    if (shouldSurfaceVariable(name)) names.add(name);
  }

  return Array.from(names).sort((left, right) => {
    const serviceCompare = inferServiceName(left).localeCompare(inferServiceName(right));
    return serviceCompare || left.localeCompare(right);
  });
}

function getSecretValues() {
  return getDiscoveredVariableNames()
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

function getVariables(testResults = new Map<string, ServiceTestResult>()) {
  return getDiscoveredVariableNames().map((variableName): IntegrationVariable => {
    const serviceName = inferServiceName(variableName);
    const result = testResults.get(serviceName);

    return {
      variableName,
      serviceName,
      configured: Boolean(process.env[variableName]),
      source: 'Environment',
      status: result?.status ?? 'UNKNOWN',
      latency: result?.latency ?? null,
      error: result?.error ?? null,
      lastTestedAt: result?.lastTestedAt ?? null,
    };
  });
}

function buildSummary(integrations: IntegrationVariable[]) {
  return {
    totalIntegrationsDetected: integrations.length,
    configuredIntegrations: integrations.filter((item) => item.configured).length,
    testedIntegrations: integrations.filter((item) => item.status !== 'UNKNOWN').length,
    passingIntegrations: integrations.filter((item) => item.status === 'PASS').length,
    failingIntegrations: integrations.filter((item) => item.status === 'FAIL').length,
  };
}

async function runTest(serviceName: KnownService, action: () => Promise<void>): Promise<ServiceTestResult> {
  const startedAt = Date.now();
  const lastTestedAt = new Date().toISOString();

  try {
    await action();
    return {
      serviceName,
      status: 'PASS',
      latency: Date.now() - startedAt,
      error: null,
      lastTestedAt,
    };
  } catch (error) {
    return {
      serviceName,
      status: 'FAIL',
      latency: Date.now() - startedAt,
      error: sanitizeError(error),
      lastTestedAt,
    };
  }
}

async function testDatabase() {
  return runTest('Database', async () => {
    await getDb().execute(sql`SELECT 1`);
  });
}

async function testRedis() {
  return runTest('Redis', async () => {
    const client = new Redis({
      url: requireEnv('KV_REST_API_URL'),
      token: requireEnv('KV_REST_API_TOKEN'),
    });
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

async function testFirecrawl() {
  return runTest('Firecrawl', async () => {
    const apiKey = requireEnv('FIRECRAWL_API_KEY');
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
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
async function testQStash() {
  return runTest('QStash', async () => {
    requireEnv('QSTASH_TOKEN');
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
    testFirecrawl(),
    testQStash(),
    testDatabase(),
    testRedis(),
    testClerk(),
  ]);
  const resultMap = new Map<string, ServiceTestResult>();

  for (const result of results) {
    resultMap.set(result.serviceName, result);
  }

  const integrations = getVariables(resultMap);

  return {
    integrations,
    summary: buildSummary(integrations),
  };
}

function getUnknownIntegrations() {
  const integrations = getVariables();

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
