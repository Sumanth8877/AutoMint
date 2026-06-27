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
import { logger } from '@/lib/logger';
import { SUPPORTED_CHAINS, type ChainKey } from '@/lib/blockchain/chains';
import { estimateGas } from '@/lib/blockchain/gas';

import type { MintPhase } from '@/types/mint';
import { instantMintSchema, formatZodError } from '@/lib/api/schemas';
import { z } from 'zod';

function asSupportedChain(chain: string): ChainKey {
  if (!(chain in SUPPORTED_CHAINS)) {
    throw new Error(`Unsupported chain. Supported: ${Object.keys(SUPPORTED_CHAINS).join(', ')}`);
  }
  return chain as ChainKey;
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
    logger.info('resolveMintIntent failed — discovery tiers will handle it', { area: 'instant-mint' });
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

export async function POST(request: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const rawBody = await parseJsonBody(request);
    const parsed = instantMintSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
    }
    const { url } = parsed.data;

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
    const mintedPhases = new Set<string>(
      existingTasks
        .filter(t => t.status === 'completed')
        .map(t => t.phase || 'public')
    );

    // M-04/M-05 Fix: replaced dead getBestRpcUrl+estimateGas stubs with the
    // real estimateGas() from gas.ts, which uses EIP-1559 (baseFee*2 + tip)
    // instead of the legacy eth_gasPrice the stubs used.
    const gasEstimate = await estimateGas(supportedChain);

    // M-06 Fix: fetch execution defaults once and pass to analyzer.
    // Previously getEffectiveExecutionDefaults was called twice (at chars 11187
    // and 11585), and the first result was mutated before being used.
    const defaults = await getEffectiveExecutionDefaults(authResult.userId);
    const analyzerSettings = { ...defaults, autoDetectSocials: false };
    const analysis = await runAnalyzer({ userId: authResult.userId, input: url, settings: analyzerSettings });
    // Skip risk assessment for instant mint - will be done during task execution
    const riskAssessment = null;

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

    // C-03 Fix: wallet.balance in the DB is only refreshed by Alchemy webhooks
    // and can be hours stale. A user who just funded their wallet would fail the
    // balance check even though they have sufficient funds on-chain.
    //
    // If balanceUpdatedAt is missing OR older than 60 seconds, fetch the current
    // on-chain balance before gating. This adds ~100-200ms only when stale.
    // The on-chain simulation inside executeMint() serves as a final safety net.
    let currentBalance = wallet.balance ? parseFloat(wallet.balance) : 0;
    const BALANCE_STALE_MS = 60_000;
    const isStale =
      !wallet.balanceUpdatedAt ||
      Date.now() - new Date(wallet.balanceUpdatedAt).getTime() > BALANCE_STALE_MS;

    if (isStale) {
      try {
        const { getWalletBalance } = await import('@/lib/blockchain/wallet');
        const freshBalance = await getWalletBalance(wallet.address, wallet.chain);
        currentBalance = parseFloat(freshBalance.balance);
      } catch {
        // Non-fatal: fall back to cached value if the RPC is temporarily unavailable.
        // executeMint()'s on-chain simulation will catch the real shortfall.
        logger.info('Failed to fetch fresh balance — using cached value', { area: 'instant-mint', 
          walletId: wallet.id,
        });
      }
    }

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
        // C-02 Fix: the unique constraint on collections is a composite index
        // on (userId, contractAddress, chain) — NOT contractAddress alone.
        // Targeting only contractAddress caused a DB error on every conflict
        // because PostgreSQL found no matching single-column unique constraint.
        target: [collections.userId, collections.contractAddress, collections.chain],
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
    // L-09 Fix: pass the user's configured gasStrategy, maxRetries, and
    // riskThreshold from executionSettings into the task so QStash worker
    // and executeMintTask use the correct per-user values instead of the
    // hardcoded defaults baked into addMintTask's fallback values.
    const task = await addMintTask(authResult.userId, {
      walletId: defaults.defaultWalletId,
      collectionId: collection.id,
      quantity: 1,
      chain: supportedChain,
      gasStrategy: defaults.gasStrategy,
      maxRetries: defaults.maxRetries,
      riskThreshold: defaults.riskThreshold,
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
