import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { resolveMintIntent, type MintIntent } from '@/lib/resolve-mint-intent';
import { discoverMintRequirements } from '@/lib/services/mint-discovery.service';
import { runAnalyzer } from '@/lib/services/analyzer.service';
import { addMintTask, executeMintTask } from '@/lib/services/mint.service';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { scheduleMint } from '@/lib/services/qstash.service';
import { getDb } from '@/lib/db';
import { collections, mintTasks, wallets } from '@/drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

const SUPPORTED_CHAINS = ['ethereum', 'base', 'polygon'] as const;
type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

function asSupportedChain(chain: string): SupportedChain {
  if (!SUPPORTED_CHAINS.includes(chain as SupportedChain)) {
    throw new Error(`Unsupported chain. Supported: ${SUPPORTED_CHAINS.join(', ')}`);
  }
  return chain as SupportedChain;
}

async function resolveMintUrl(url: string): Promise<MintIntent & { mintPhases: MintPhase[]; mintTime?: Date; resolvedStartTime?: Date | null }> {
  // Tier 1: structured URL resolver
  let tier1Partial: Parameters<typeof discoverMintRequirements>[1] = {};
  try {
    const intent = await resolveMintIntent(url);
    if (intent.contractAddress) {
      tier1Partial = {
        contractAddress: intent.contractAddress,
        chain: intent.chain,
        collectionName: intent.collectionName,
      };
    }
  } catch {
    console.log('[instant-mint] resolveMintIntent failed — discovery tiers will handle it');
  }

  // Tiers 2→3: Jina/Firecrawl in parallel → Browserbase if still missing
  const discovered = await discoverMintRequirements(url, tier1Partial);

  return {
    contractAddress: discovered.contractAddress,
    chain: discovered.chain ?? 'ethereum',
    collectionName: discovered.collectionName,
    collectionSlug: undefined,
    sourceUrl: url,
    isValid: true,
    confidence: discovered.confidence,
    sourcePlatform: 'custom' as const,
    mintPhases: discovered.mintPhases ?? [{ type: 'public' as const, proofRequired: false }],
    resolvedStartTime: discovered.mintStartTime ?? null,
  };
}

async function fetchWithFirecrawl(url: string): Promise<MintIntent & { mintPhases: MintPhase[]; mintTime?: Date }> {
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

async function fetchWithJina(url: string): Promise<MintIntent & { mintPhases: MintPhase[]; mintTime?: Date }> {
  // Implement Jina AI reader API
  const response = await fetch(`https://r.jina.ai/${url}`, {
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

async function fetchWithBrowserbase(url: string): Promise<MintIntent & { mintPhases: MintPhase[]; mintTime?: Date }> {
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

function parseMintDetailsFromContent(content: string, url: string): MintIntent & { mintPhases: MintPhase[] } {
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

  // Extract mint phases (WL, allowlist, public)
  const mintPhases = extractMintPhases(content);

  return {
    contractAddress: contractAddress || undefined,
    chain,
    collectionName: extractCollectionName(content) || undefined,
    collectionSlug: extractCollectionSlug(url) || undefined,
    sourceUrl: url,
    isValid: !!contractAddress,
    confidence: contractAddress ? 0.8 : 0.3,
    sourcePlatform: 'custom' as const,
    mintPhases,
  };
}

type MintPhase = {
  type: 'whitelist' | 'allowlist' | 'public';
  startTime?: Date;
  endTime?: Date;
  price?: string;
  proofRequired?: boolean;
};

function extractMintPhases(content: string): MintPhase[] {
  const phases: MintPhase[] = [];
  const contentLower = content.toLowerCase();

  // Detect whitelist phase
  if (contentLower.includes('whitelist') || contentLower.includes('wl') || contentLower.includes('allowlist')) {
    phases.push({
      type: contentLower.includes('allowlist') ? 'allowlist' : 'whitelist',
      proofRequired: true,
    });
  }

  // Detect public phase
  if (contentLower.includes('public') || contentLower.includes('public sale') || contentLower.includes('open mint')) {
    phases.push({
      type: 'public',
      proofRequired: false,
    });
  }

  // If no phases detected, default to public
  if (phases.length === 0) {
    phases.push({
      type: 'public',
      proofRequired: false,
    });
  }

  return phases;
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

async function estimateGas(rpcUrl: string): Promise<{ standard: string; recommended: string }> {
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

    // Resolve mint URL with fallback chain to get mint phases
    const resolved = await resolveMintUrl(url);
    const { contractAddress, chain, mintPhases } = resolved;

    if (!contractAddress) {
      throw new Error('Could not resolve contract address from URL');
    }

    const supportedChain = asSupportedChain(chain);

    // Check for existing tasks for this contract
    const existingTasks = await getDb()
      .select()
      .from(mintTasks)
      .where(and(
        eq(mintTasks.userId, authResult.userId),
        eq(mintTasks.contractAddress, contractAddress.toLowerCase())
      ))
      .orderBy(desc(mintTasks.createdAt));

    // Determine which phases have already been minted
    const mintedPhases = new Set(
      existingTasks
        .filter(t => t.status === 'completed')
        .map(t => t.phase || 'public')
    );

    // Get best RPC URL
    const rpcUrl = await getBestRpcUrl(supportedChain);

    // Estimate gas
    const gasEstimate = await estimateGas(rpcUrl);

    // Run analyzer for risk assessment with minimal depth (no social discovery)
    const settings = await getEffectiveExecutionDefaults(authResult.userId);
    settings.autoDetectSocials = false; // Disable social discovery for mint flow
    const analysis = await runAnalyzer({ userId: authResult.userId, input: url, settings });
    // Skip risk assessment for instant mint - will be done during task execution
    const riskAssessment = null;

    // Get execution defaults
    const defaults = await getEffectiveExecutionDefaults(authResult.userId);

    // Check if user has a default wallet
    if (!defaults.defaultWalletId) {
      throw new Error('No default wallet configured. Please add a wallet in your settings.');
    }

    // Verify wallet exists
    const [wallet] = await getDb()
      .select()
      .from(wallets)
      .where(and(
        eq(wallets.id, defaults.defaultWalletId),
        eq(wallets.userId, authResult.userId)
      ))
      .limit(1);

    if (!wallet) {
      throw new Error('Default wallet not found. Please configure a valid wallet in your settings.');
    }

    // Check mint status first before checking balance
    const mintStartTime =
      analysis?.requirements?.mintStartTime ??
      analysis?.mintState?.startTime ??
      resolved.resolvedStartTime ??
      null;
    const mintStatus = analysis?.mintState.status?.toLowerCase() || '';
    const isMintLive = mintStartTime ? new Date(mintStartTime) <= new Date() : 
                        mintStatus === 'live' || mintStatus === 'active' || mintStatus === 'minting';
    const hasMintInfo = analysis?.mintState.status || analysis?.requirements.mintStartTime;

    if (!hasMintInfo) {
      throw new Error('This collection does not have mint information available. It may not be a minting collection.');
    }

    if (!isMintLive && !mintStartTime) {
      throw new Error('This collection is not currently minting and no upcoming mint date is available.');
    }

    // Now check wallet balance only if mint is live or scheduled
    const mintPrice = analysis?.requirements.mintPrice || '0';
    const currentBalance = wallet.balance ? parseFloat(wallet.balance) : 0;
    const requiredAmount = parseFloat(mintPrice) + 0.01; // mint price + estimated gas
    
    if (currentBalance < requiredAmount) {
      const needed = (requiredAmount - currentBalance).toFixed(4);
      throw new Error(`Insufficient funds in wallet. Current balance: ${currentBalance.toFixed(4)} ${wallet.balanceSymbol || 'ETH'}. Required: ${requiredAmount.toFixed(4)} ${wallet.balanceSymbol || 'ETH'} (mint: ${mintPrice} ETH + gas: ~0.01 ETH). Need ${needed} more.`);
    }

    // Upsert collection
    const contractAddressLower = contractAddress.toLowerCase();
    const collectionValues = {
      name: analysis?.metadata.name ?? resolved.collectionName ?? 'Unknown Collection',
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
        contractAddress: contractAddressLower,
        chain: supportedChain,
        ...collectionValues,
      })
      .onConflictDoUpdate({
        target: collections.contractAddress,
        set: collectionValues,
      });

    // Determine which phase to mint
    let targetPhase: MintPhase | null = null;

    if (isMintLive) {
      // Mint is live, use public phase
      targetPhase = mintPhases.find(p => p.type === 'public') || mintPhases[0];
    } else {
      // Mint is not live, find the earliest phase not yet minted
      for (const phase of mintPhases) {
        const phaseKey = phase.type;
        if (!mintedPhases.has(phaseKey)) {
          targetPhase = phase;
          break;
        }
      }
    }

    if (!targetPhase) {
      return NextResponse.json({
        error: 'All phases have already been minted for this collection',
        existingTasks: existingTasks.map(t => ({ id: t.id, status: t.status, phase: t.phase })),
      }, { status: 400 });
    }

    // Find the collection by contract address to get its ID
    const [collection] = await getDb()
      .select()
      .from(collections)
      .where(and(
        eq(collections.contractAddress, contractAddressLower),
        eq(collections.userId, authResult.userId)
      ))
      .limit(1);

    if (!collection) {
      throw new Error('Collection not found. Please ensure the collection exists in your database.');
    }

    // Create mint task
    const task = await addMintTask(authResult.userId, {
      walletId: defaults.defaultWalletId,
      collectionId: collection.id,
      quantity: 1,
      chain: supportedChain,
    });

    // Update task with phase information
    await getDb()
      .update(mintTasks)
      .set({ phase: targetPhase.type })
      .where(eq(mintTasks.id, task.id));

    if (isMintLive) {
      // Execute mint immediately
      await executeMintTask(task.id, authResult.userId);
    } else {
      // Schedule mint for the appropriate time
      const scheduledTime = mintStartTime ? new Date(mintStartTime) : new Date(Date.now() + 30 * 60 * 1000); // Default to 30 mins if no time
      await scheduleMint({ taskId: task.id, userId: authResult.userId, scheduledTime });
    }

    return NextResponse.json({
      success: true,
      task: {
        id: task.id,
        status: task.status,
        contractAddress: contractAddressLower,
        chain: supportedChain,
        quantity: 1,
        phase: targetPhase.type,
        scheduledTime: isMintLive ? undefined : mintStartTime,
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
