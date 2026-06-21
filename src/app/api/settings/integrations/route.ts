import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { requireAdminApiSession } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { getChain } from '@/lib/blockchain/chains';
import {
  deleteSetting,
  getAllSettings,
  getSetting,
  INTEGRATION_SETTING_KEYS,
  setSetting,
  type IntegrationSettingKey,
} from '@/lib/services/integration-settings.service';

type IntegrationBody = {
  action?: 'save' | 'test';
  alchemyApiKey?: string;
  quickNodeRpcUrl?: string;
  key?: IntegrationSettingKey;
};

function maskSecret(value: string | null | undefined) {
  if (!value) return null;
  const suffix = value.slice(-4);
  return `*****${suffix}`;
}

function settingResponse(value: string | null | undefined) {
  return {
    configured: Boolean(value),
    maskedValue: maskSecret(value),
  };
}

function isSupportedKey(key: unknown): key is IntegrationSettingKey {
  return typeof key === 'string' && INTEGRATION_SETTING_KEYS.includes(key as IntegrationSettingKey);
}

function getAlchemyUrl(apiKey: string) {
  return `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
}

async function testRpcProvider(provider: 'alchemy' | 'quicknode', url: string) {
  const client = createPublicClient({
    chain: getChain('ethereum'),
    transport: http(url, { timeout: 12_000 }),
  });
  const startedAt = Date.now();
  const blockNumber = await client.getBlockNumber();

  return {
    status: 'PASS' as const,
    provider,
    currentBlock: blockNumber.toString(),
    latency: Date.now() - startedAt,
  };
}

async function testSavedConnections() {
  const [alchemy, quicknode] = await Promise.all([
    getSetting('ALCHEMY_API_KEY'),
    getSetting('QUICKNODE_RPC_URL'),
  ]);

  const results: Record<'alchemy' | 'quicknode', Record<string, unknown>> = {
    alchemy: {
      status: 'FAIL',
      provider: 'alchemy',
      error: 'Alchemy API Key is not configured',
    },
    quicknode: {
      status: 'FAIL',
      provider: 'quicknode',
      error: 'QuickNode RPC URL is not configured',
    },
  };

  if (alchemy?.value) {
    try {
      results.alchemy = await testRpcProvider('alchemy', getAlchemyUrl(alchemy.value));
    } catch (error) {
      results.alchemy = {
        status: 'FAIL',
        provider: 'alchemy',
        error: getErrorMessage(error, 'Alchemy test failed'),
      };
    }
  }

  if (quicknode?.value) {
    try {
      results.quicknode = await testRpcProvider('quicknode', quicknode.value);
    } catch (error) {
      results.quicknode = {
        status: 'FAIL',
        provider: 'quicknode',
        error: getErrorMessage(error, 'QuickNode test failed'),
      };
    }
  }

  return results;
}

async function loadMaskedSettings() {
  const settings = await getAllSettings();

  return {
    alchemyApiKey: settingResponse(settings.ALCHEMY_API_KEY?.value),
    quickNodeRpcUrl: settingResponse(settings.QUICKNODE_RPC_URL?.value),
  };
}

export async function GET() {
  try {
    const authResult = await requireAdminApiSession();
    if ('error' in authResult) return authResult.error;

    return NextResponse.json({ settings: await loadMaskedSettings() });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to load integration settings') }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authResult = await requireAdminApiSession();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<IntegrationBody>(req);
    if (body.action === 'test') {
      return NextResponse.json({ results: await testSavedConnections() });
    }

    const writes: Array<Promise<unknown>> = [];
    if (typeof body.alchemyApiKey === 'string' && body.alchemyApiKey.trim()) {
      writes.push(setSetting('ALCHEMY_API_KEY', body.alchemyApiKey));
    }
    if (typeof body.quickNodeRpcUrl === 'string' && body.quickNodeRpcUrl.trim()) {
      new URL(body.quickNodeRpcUrl.trim());
      writes.push(setSetting('QUICKNODE_RPC_URL', body.quickNodeRpcUrl));
    }

    if (writes.length === 0) {
      return NextResponse.json({ error: 'At least one integration setting is required' }, { status: 400 });
    }

    await Promise.all(writes);
    return NextResponse.json({ settings: await loadMaskedSettings() });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to save integration settings');
    const status = message === 'Invalid JSON request body' || message.includes('Invalid URL') || message.includes('required') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: Request) {
  try {
    const authResult = await requireAdminApiSession();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<IntegrationBody>(req);
    if (!isSupportedKey(body.key)) {
      return NextResponse.json({ error: 'Supported integration setting key is required' }, { status: 400 });
    }

    await deleteSetting(body.key);
    return NextResponse.json({ settings: await loadMaskedSettings() });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to delete integration setting');
    const status = message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
