import { createPublicClient, http } from 'viem';
import { sql } from 'drizzle-orm';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { MetricCard } from '@/components/ui/metric-card';
import { PageHeader } from '@/components/ui/page-header';
import { getChain } from '@/lib/blockchain/chains';
import { getDb } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import DeleteRuntimeCheckButton from './delete-runtime-check-button';

export const dynamic = 'force-dynamic';

const ENVIRONMENT_VARIABLES = [
  'DATABASE_URL',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'QSTASH_TOKEN',
  'ALCHEMY_API_KEY',
  'QUICKNODE_RPC_URL',
  'QUICKNODE_WSS_URL',
  'JINA_API_KEY',
  'FIRECRAWL_API_KEY',
  'BROWSERBASE_API_KEY',
  'BROWSERBASE_PROJECT_ID',
  'NEXT_PUBLIC_SENTRY_DSN',
] as const;

type EnvName = typeof ENVIRONMENT_VARIABLES[number];

type EnvStatus = {
  name: EnvName;
  exists: boolean;
  length: number;
};

type ServiceStatus = {
  name: string;
  status: 'PASS' | 'FAIL';
  latency: number;
  error: string | null;
  summary: string;
};

function getEnvironmentStatuses(): EnvStatus[] {
  return ENVIRONMENT_VARIABLES.map((name) => {
    const value = process.env[name];
    return {
      name,
      exists: Boolean(value),
      length: value?.length ?? 0,
    };
  });
}

function getKnownSecretValues() {
  return ENVIRONMENT_VARIABLES
    .map((name) => process.env[name])
    .filter((value): value is string => Boolean(value && value.length >= 4));
}

function sanitizeError(error: unknown) {
  let message = error instanceof Error ? error.message : String(error);

  for (const secret of getKnownSecretValues()) {
    message = message.split(secret).join('[redacted]');
  }

  return message;
}

async function timeService(name: string, action: () => Promise<string>): Promise<ServiceStatus> {
  const startedAt = Date.now();

  try {
    const summary = await action();
    return {
      name,
      status: 'PASS',
      latency: Date.now() - startedAt,
      error: null,
      summary,
    };
  } catch (error) {
    return {
      name,
      status: 'FAIL',
      latency: Date.now() - startedAt,
      error: sanitizeError(error),
      summary: 'Runtime verification failed.',
    };
  }
}

function requireEnv(name: EnvName) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function testDatabase() {
  return timeService('Database', async () => {
    await getDb().execute(sql`SELECT 1`);
    return 'SELECT 1 completed.';
  });
}

async function testRedis() {
  return timeService('Redis', async () => {
    const client = getRedisClient();
    const key = `runtime-check:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const value = `ok:${Date.now()}`;

    await client.set(key, value, { ex: 60 });
    const stored = await client.get<string>(key);
    await client.del(key);

    if (stored !== value) {
      throw new Error('Redis GET did not return the value written by SET');
    }

    return 'Set, get, and delete completed.';
  });
}

function createEthereumClient(url: string) {
  return createPublicClient({
    chain: getChain('ethereum'),
    transport: http(url, { timeout: 12_000 }),
  });
}

async function testAlchemy() {
  return timeService('Alchemy', async () => {
    const apiKey = requireEnv('ALCHEMY_API_KEY');
    const client = createEthereumClient(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`);
    await client.getBlockNumber();
    return 'Latest block request completed.';
  });
}

async function testQuickNode() {
  return timeService('QuickNode', async () => {
    const rpcUrl = requireEnv('QUICKNODE_RPC_URL');
    const client = createEthereumClient(rpcUrl);
    await client.getBlockNumber();
    return 'Latest block request completed.';
  });
}

async function testJina() {
  return timeService('Jina', async () => {
    const headers: Record<string, string> = {
      Accept: 'text/plain',
    };
    const token = process.env.JINA_API_KEY;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch('https://r.jina.ai/http://example.com', {
      headers,
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      throw new Error(`Jina extraction failed with status ${response.status}`);
    }

    const text = await response.text();
    if (text.trim().length < 20) {
      throw new Error('Jina returned an empty extraction response');
    }

    return 'Simple URL extraction completed.';
  });
}

async function testFirecrawl() {
  return timeService('Firecrawl', async () => {
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
      throw new Error(`Firecrawl authentication failed with status ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`Firecrawl authentication request failed with status ${response.status}`);
    }

    return 'Authenticated request accepted.';
  });
}

async function testBrowserbase() {
  return timeService('Browserbase', async () => {
    requireEnv('BROWSERBASE_API_KEY');
    requireEnv('BROWSERBASE_PROJECT_ID');
    return 'Client configuration detected.';
  });
}

async function testQStash() {
  return timeService('QStash', async () => {
    requireEnv('QSTASH_TOKEN');
    return 'Client configuration detected.';
  });
}

async function testSentry() {
  return timeService('Sentry', async () => {
    requireEnv('NEXT_PUBLIC_SENTRY_DSN');
    return 'Configuration detected.';
  });
}

async function getServiceStatuses() {
  return Promise.all([
    testDatabase(),
    testRedis(),
    testAlchemy(),
    testQuickNode(),
    testJina(),
    testFirecrawl(),
    testBrowserbase(),
    testQStash(),
    testSentry(),
  ]);
}

function statusVariant(status: ServiceStatus['status']) {
  return status === 'PASS' ? 'success' : 'danger';
}

export default async function RuntimeCheckPage() {
  const envStatuses = getEnvironmentStatuses();
  const serviceStatuses = await getServiceStatuses();
  const totalVariablesFound = envStatuses.filter((item) => item.exists).length;
  const missingVariables = envStatuses.length - totalVariablesFound;
  const servicesHealthy = serviceStatuses.filter((item) => item.status === 'PASS').length;
  const servicesFailing = serviceStatuses.length - servicesHealthy;

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Runtime Environment Verification"
        description="Verify runtime configuration without displaying secret values."
        actions={<DeleteRuntimeCheckButton />}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Total Variables Found" value={totalVariablesFound} detail={`${envStatuses.length} checked`} tone="accent" />
        <MetricCard label="Missing Variables" value={missingVariables} detail="Required runtime entries" tone={missingVariables === 0 ? 'success' : 'danger'} />
        <MetricCard label="Services Healthy" value={servicesHealthy} detail={`${serviceStatuses.length} checked`} tone="success" />
        <MetricCard label="Services Failing" value={servicesFailing} detail="Needs attention" tone={servicesFailing === 0 ? 'success' : 'danger'} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold text-text">Variables</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[720px] w-full text-left text-sm">
            <thead className="border-b border-border bg-white/5 text-xs uppercase text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Variable Name</th>
                <th className="px-5 py-3 font-medium">Exists</th>
                <th className="px-5 py-3 font-medium">Length</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {envStatuses.map((item) => (
                <tr key={item.name}>
                  <td className="px-5 py-3 font-mono text-text">{item.name}</td>
                  <td className="px-5 py-3">
                    <Badge variant={item.exists ? 'success' : 'danger'}>{String(item.exists)}</Badge>
                  </td>
                  <td className="px-5 py-3 font-mono text-muted">{item.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold text-text">Test</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="border-b border-border bg-white/5 text-xs uppercase text-muted">
              <tr>
                <th className="px-5 py-3 font-medium">Service</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Latency</th>
                <th className="px-5 py-3 font-medium">Error Message</th>
                <th className="px-5 py-3 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {serviceStatuses.map((item) => (
                <tr key={item.name}>
                  <td className="px-5 py-3 font-medium text-text">{item.name}</td>
                  <td className="px-5 py-3">
                    <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                  </td>
                  <td className="px-5 py-3 font-mono text-muted">{item.latency}ms</td>
                  <td className="max-w-[320px] px-5 py-3 text-danger">{item.error ?? 'None'}</td>
                  <td className="max-w-[320px] px-5 py-3 text-muted">{item.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
