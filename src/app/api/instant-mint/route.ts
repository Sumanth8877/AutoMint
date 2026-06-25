import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { resolveMintIntent, type MintIntent } from '@/lib/resolve-mint-intent';
import { AnalyzerResolutionError, normalizeAnalyzerInput, runAnalyzer, type AnalyzerResult } from '@/lib/services/analyzer.service';
import { analyzeMintRisk } from '@/lib/services/risk.service';
import { addMintTask, executeMintTask } from '@/lib/services/mint.service';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { getDb } from '@/lib/db';
import { collections } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

function asSupportedChain(chain: string): SupportedChain {
  if (!SUPPORTED_CHAINS.includes(chain as SupportedChain)) {
    throw new Error(`Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
  }
  return chain as SupportedChain;
}

async function resolveMintUrl(url: string): Promise<MintIntent> {
  // First attempt: URL resolver
  try {
    const intent = await resolveMintIntent(url);
    if (intent.contractAddress) {
      return intent;
    }
  } catch (error) {
    console.log('URL resolver failed, trying fallback methods');
  }

  // Fallback: Firecrawl + Jina in parallel
  try {
    const [firecrawlResult, jinaResult] = await Promise.allSettled([
      fetchWithFirecrawl(url),
      fetchWithJina(url),
    ]);

    if (firecrawlResult.status === 'fulfilled' && firecrawlResult.value.contractAddress) {
      return firecrawlResult.value;
    }
    if (jinaResult.status === 'fulfilled' && jinaResult.value.contractAddress) {
      return jinaResult.value;
    }
  } catch (error) {
    console.log('Firecrawl + Jina failed, trying Browserbase');
  }

  // Final fallback: Browserbase with Playwright
  try {
    const browserbaseResult = await fetchWithBrowserbase(url);
    if (browserbaseResult.contractAddress) {
      return browserbaseResult;
    }
  } catch (error) {
    console.log('Browserbase failed');
  }

  throw new Error('Failed to resolve mint URL. All resolution methods failed.');
}

async function fetchWithFirecrawl(url: string): Promise<MintIntent> {
  // Implement Firecrawl API call
  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.FIRECRAWL_API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'html'],
    }),
  });

  if (!response.ok) {
    throw new Error('Firecrawl API failed');
  }

  const data = await response.json();
  // Parse the response to extract mint details
  return parseMintDetailsFromContent(data.markdown || data.html, url);
}

async function fetchWithJina(url: string): Promise<MintIntent> {
  // Implement Jina AI reader API
  const response = await fetch(`https://r.jina.ai/http://${url}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error('Jina API failed');
  }

  const content = await response.text();
  return parseMintDetailsFromContent(content, url);
}

async function fetchWithBrowserbase(url: string): Promise<MintIntent> {
  // Implement Browserbase with Playwright
  const response = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BROWSERBASE_API_KEY}`,
    },
    body: JSON.stringify({
      projectId: process.env.BROWSERBASE_PROJECT_ID,
    }),
  });

  if (!response.ok) {
    throw new Error('Browserbase session creation failed');
  }

  const session = await response.json();

  // Navigate to URL and extract content
  const navigateResponse = await fetch(`https://api.browserbase.com/v1/sessions/${session.id}/navigate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.BROWSERBASE_API_KEY}`,
    },
    body: JSON.stringify({ url }),
  });

  if (!navigateResponse.ok) {
    throw new Error('Browserbase navigation failed');
  }

  // Get page content
  const contentResponse = await fetch(`https://api.browserbase.com/v1/sessions/${session.id}/content`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${process.env.BROWSERBASE_API_KEY}`,
    },
  });

  if (!contentResponse.ok) {
    throw new Error('Browserbase content extraction failed');
  }

  const contentData = await contentResponse.json();
  return parseMintDetailsFromContent(contentData.content, url);
}

function parseMintDetailsFromContent(content: string, url: string): MintIntent {
  // Parse contract address from content
  const contractAddressMatch = content.match(/0x[a-fA-F0-9]{40}/);
  const contractAddress = contractAddressMatch ? contractAddressMatch[0] : null;

  // Detect chain from URL or content
  let chain = 'ethereum';
  if (url.includes('base.') || content.toLowerCase().includes('base')) {
    chain = 'base';
  } else if (url.includes('polygon.') || content.toLowerCase().includes('polygon')) {
    chain = 'polygon';
  }

  return {
    contractAddress: contractAddress || undefined,
    chain,
    collectionName: extractCollectionName(content) || undefined,
    collectionSlug: extractCollectionSlug(url) || undefined,
    sourceUrl: url,
    isValid: !!contractAddress,
    confidence: contractAddress ? 0.8 : 0.3,
    sourcePlatform: 'custom' as const,
  };
}

function extractCollectionName(content: string): string | null {
  // Try to extract collection name from content
  const patterns = [
    /collection["\s:]+([^"\s,}]+)/i,
    /name["\s:]+([^"\s,}]+)/i,
    /title["\s:]+([^"\s,}]+)/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      return match[1].replace(/["']/g, '').trim();
    }
  }

  return null;
}

function extractCollectionSlug(url: string): string | null {
  // Extract collection slug from URL
  const urlParts = url.split('/').filter(Boolean);
  return urlParts[urlParts.length - 1] || null;
}

async function getBestRpcUrl(chain: SupportedChain): Promise<string> {
  // Implement auto RPC routing logic
  // This should select the best RPC based on latency, health, etc.
  const rpcUrls: Record<SupportedChain, string[]> = {
    ethereum: [
      process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
      'https://rpc.ankr.com/eth',
      'https://ethereum.publicnode.com',
    ],
    base: [
      process.env.BASE_RPC_URL || 'https://base.llamarpc.com',
      'https://rpc.ankr.com/base',
      'https://base.publicnode.com',
    ],
    polygon: [
      process.env.POLYGON_RPC_URL || 'https://polygon.llamarpc.com',
      'https://rpc.ankr.com/polygon',
      'https://polygon.publicnode.com',
    ],
  };

  const chainRpcs = rpcUrls[chain];
  
  // Simple health check - return first available
  for (const rpc of chainRpcs) {
    try {
      const response = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      });
      if (response.ok) {
        return rpc;
      }
    } catch {
      continue;
    }
  }

  return chainRpcs[0]; // Fallback to first
}

async function estimateGas(chain: SupportedChain, rpcUrl: string, contractAddress: string): Promise<{ standard: string; recommended: string }> {
  // Implement gas estimation
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_gasPrice',
        params: [],
        id: 1,
      }),
    });

    const data = await response.json();
    const gasPrice = data.result || '0x0';
    const gasPriceWei = parseInt(gasPrice, 16);
    const gasPriceGwei = (gasPriceWei / 1e9).toFixed(2);

    return {
      standard: gasPriceGwei,
      recommended: (gasPriceWei * 1.1 / 1e9).toFixed(2), // 10% higher for priority
    };
  } catch {
    return {
      standard: '20',
      recommended: '22',
    };
  }
}

export async function POST(request: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody(request) as { url: string };
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Resolve mint URL with fallback chain
    const intent = await resolveMintIntent(url);

    if (!intent.contractAddress) {
      throw new Error('Could not resolve contract address from URL');
    }

    const chain = asSupportedChain(intent.chain);

    // Get best RPC URL
    const rpcUrl = await getBestRpcUrl(chain);

    // Estimate gas
    const gasEstimate = await estimateGas(chain, rpcUrl, intent.contractAddress);

    // Run analyzer for risk assessment
    const analysis = await runAnalyzer({ userId: authResult.userId, input: url });
    const riskAssessment = await analyzeMintRisk(intent.contractAddress);

    // Get execution defaults
    const defaults = await getEffectiveExecutionDefaults(authResult.userId);

    // Upsert collection
    const contractAddress = intent.contractAddress.toLowerCase();
    const collectionValues = {
      name: analysis?.metadata.name ?? intent.collectionName ?? 'Unknown Collection',
      tokenStandard: analysis?.metadata.tokenStandard ?? undefined,
      owner: analysis?.metadata.owner ?? undefined,
      totalSupply: analysis?.metadata.totalSupply ?? undefined,
      mintStatus: analysis?.mintState.status.toLowerCase() ?? undefined,
      mintPrice: analysis?.requirements.mintPrice ?? undefined,
      mintStart: analysis?.requirements.mintStartTime ?? analysis?.mintState.startTime ?? undefined,
      mintEnd: analysis?.requirements.mintEndTime ?? analysis?.mintState.endTime ?? undefined,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    await getDb()
      .insert(collections)
      .values({
        userId: authResult.userId,
        contractAddress,
        chain,
        ...collectionValues,
      })
      .onConflictDoUpdate({
        target: collections.contractAddress,
        set: collectionValues,
      });

    // Create mint task with default values
    const task = await addMintTask(authResult.userId, {
      walletId: defaults.defaultWalletId,
      collectionId: contractAddress,
      quantity: 1, // Default quantity
      chain,
    });

    // Execute mint immediately
    await executeMintTask(task.id, authResult.userId);

    return NextResponse.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        contractAddress,
        chain,
        quantity: 1,
        gasEstimate,
        risk: riskAssessment,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, 'Failed to execute instant mint') },
      { status: 500 }
    );
  }
}
