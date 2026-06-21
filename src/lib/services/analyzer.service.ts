import 'server-only';

import { getCollectionMetadata, type CollectionMetadata } from '@/lib/blockchain/collections';
import {
  resolveMintIntent,
  type AnalyzerDebugLogEntry,
  type AnalyzerDebugLogLevel,
  type AnalyzerProviderAttempt,
  type AnalyzerResolutionTelemetry,
  type AnalyzerTiming,
  type MintIntent,
} from '@/lib/resolve-mint-intent';
import { addBreadcrumb } from '@/lib/observability/sentry';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';
import { fetchMintRequirements, type MintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState, type MintState } from '@/lib/services/mint-state.service';
import { sendTelegramNotification } from '@/lib/services/telegram.service';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { refreshRpcProviderLatency } from '@/lib/services/rpc-manager.service';
import { analyzerHistory } from '@/drizzle/schema';
import { getDb } from '@/lib/db';

type AnalyzerSettings = Awaited<ReturnType<typeof getEffectiveExecutionDefaults>>;

export type AnalyzerResult = {
  intent: MintIntent;
  metadata: Omit<CollectionMetadata, 'totalSupply'> & { totalSupply: string };
  mintState: MintState;
  requirements: MintRequirements;
  mintFunction: {
    functionName: string;
    selector: string;
    confidence: number;
  };
  analyzerPreferences: {
    autoDetectSocials: boolean;
    autoDetectContractInfo: boolean;
    autoDetectMintDetails: boolean;
    riskAnalysisEnabled: boolean;
    aiSummaryEnabled: boolean;
  };
  providerChain: AnalyzerProviderAttempt[];
  providerUsed: string;
  rpcProviderUsed: string | null;
  rpcProviders: Array<{
    provider: string;
    selected: boolean;
    configured: boolean;
    healthy: boolean;
    latencyMs: number | null;
    status: string;
  }>;
  analysisDurationMs: number;
  timingBreakdown: AnalyzerTiming[];
  logs: AnalyzerDebugLogEntry[];
  analyzedAt: string;
};

export class AnalyzerResolutionError extends Error {
  status = 422;
  intent: MintIntent;
  logs: AnalyzerDebugLogEntry[];

  constructor(intent: MintIntent, logs: AnalyzerDebugLogEntry[] = []) {
    super('Could not resolve a contract address from that URL yet.');
    this.name = 'AnalyzerResolutionError';
    this.intent = intent;
    this.logs = logs;
  }
}

export class AnalyzerExecutionError extends Error {
  status = 500;
  logs: AnalyzerDebugLogEntry[];

  constructor(message: string, logs: AnalyzerDebugLogEntry[]) {
    super(message);
    this.name = 'AnalyzerExecutionError';
    this.logs = logs;
  }
}

export function normalizeAnalyzerInput(input: string) {
  const trimmed = input.trim();
  return trimmed.startsWith('0x') ? `https://etherscan.io/address/${trimmed}` : trimmed;
}

function canUseEvmPipeline(intent: MintIntent) {
  return Boolean(intent.contractAddress?.startsWith('0x')) && ['ethereum', 'base', 'polygon'].includes(intent.chain);
}

function detectInputType(input: string) {
  const lower = input.trim().toLowerCase();
  if (/^0x[a-f0-9]{40}$/i.test(input.trim())) return 'Direct Contract';
  if (lower.includes('opensea.io')) return 'OpenSea URL';
  if (lower.includes('etherscan.io') || lower.includes('basescan.org') || lower.includes('polygonscan.com')) return 'Explorer URL';
  if (lower.includes('solscan.io')) return 'Solscan URL';
  if (lower.includes('magiceden.io')) return 'Magic Eden URL';
  return 'Unknown URL';
}

function createAnalyzerLogger() {
  const logs: AnalyzerDebugLogEntry[] = [];

  return {
    logs,
    log(level: AnalyzerDebugLogLevel, stage: string, message: string) {
      logs.push({
        timestamp: new Date().toISOString(),
        level,
        stage,
        message,
      });
    },
  };
}

async function runLogged<T>(
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void,
  stage: string,
  startMessage: string,
  successMessage: (result: T) => string,
  task: () => Promise<T>,
) {
  log('info', stage, startMessage);
  try {
    const result = await task();
    log('success', stage, successMessage(result));
    return result;
  } catch (error) {
    log('error', stage, `${startMessage} failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function runTimed<T>(
  timingBreakdown: AnalyzerTiming[],
  stage: string,
  task: () => Promise<T>,
) {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    timingBreakdown.push({ stage, durationMs: Date.now() - startedAt });
  }
}

function deriveAnalyzerScores(result: Pick<AnalyzerResult, 'intent' | 'mintFunction' | 'mintState'>) {
  const confidence = Math.round(result.intent.confidence * 100);
  const functionConfidence = Math.round(result.mintFunction.confidence * 100);
  const liveBonus = result.mintState.status === 'LIVE' ? 12 : 0;
  const readiness = Math.min(96, Math.max(24, Math.round((confidence + functionConfidence) / 2) + liveBonus));
  const risk = Math.max(12, 100 - readiness);
  const opportunity = Math.min(98, Math.max(30, readiness - risk / 4));

  return { opportunity: Math.round(opportunity), risk: Math.round(risk), readiness };
}

function selectedProviderFromChain(input: string, intent: MintIntent, providerChain: AnalyzerProviderAttempt[]) {
  const trimmed = input.trim();
  if (/^0x[a-f0-9]{40}$/i.test(trimmed)) return 'Direct Contract';
  const successfulProvider = providerChain.find((entry) => entry.status === 'success');
  if (successfulProvider) return successfulProvider.provider;
  if (intent.sourcePlatform === 'contract') return 'Explorer';
  if (intent.sourcePlatform === 'unknown') return 'Unknown';
  return intent.sourcePlatform;
}

function rpcProviderLabel(provider: 'ALCHEMY' | 'QUICKNODE' | null) {
  if (provider === 'ALCHEMY') return 'Alchemy';
  if (provider === 'QUICKNODE') return 'QuickNode';
  return null;
}

async function saveAnalyzerHistory(params: {
  userId: string;
  input: string;
  result: AnalyzerResult;
  scores: ReturnType<typeof deriveAnalyzerScores>;
  analysisDurationMs: number;
}) {
  const [record] = await getDb()
    .insert(analyzerHistory)
    .values({
      userId: params.userId,
      input: params.input,
      sourceUrl: params.result.intent.sourceUrl,
      collectionName: params.result.metadata.name ?? params.result.intent.collectionName ?? params.result.intent.collectionSlug ?? null,
      contractAddress: params.result.intent.contractAddress ?? null,
      chain: params.result.intent.chain,
      riskScore: params.scores.risk,
      opportunityScore: params.scores.opportunity,
      readinessScore: params.scores.readiness,
      mintState: params.result.mintState.status,
      providerUsed: params.result.providerUsed,
      rpcProviderUsed: params.result.rpcProviderUsed,
      providerChain: params.result.providerChain,
      timingBreakdown: params.result.timingBreakdown,
      analysisDurationMs: params.analysisDurationMs,
    })
    .returning({ id: analyzerHistory.id });

  return record.id;
}

export async function runAnalyzer(params: {
  userId: string;
  input: string;
  settings?: AnalyzerSettings;
  notify?: boolean;
}): Promise<AnalyzerResult> {
  const logger = createAnalyzerLogger();
  const { log, logs } = logger;
  const startedAt = Date.now();
  const telemetry: AnalyzerResolutionTelemetry = { providerChain: [], timingBreakdown: [] };
  try {
    const normalizedInput = normalizeAnalyzerInput(params.input);
    const settings = params.settings ?? await getEffectiveExecutionDefaults(params.userId);

    log('info', 'input', 'Analysis started');
    log('info', 'input', `Input received: ${params.input}`);
    log('success', 'input', `Input type detected: ${detectInputType(params.input)}`);

  addBreadcrumb({
    category: 'discovery',
    message: 'URL submitted',
    level: 'info',
    data: { url: normalizedInput, userId: params.userId },
  });

  const intent = await resolveMintIntent(normalizedInput, (entry) => log(entry.level, entry.stage, entry.message), telemetry);
  if (!intent.contractAddress) {
    log('error', 'contract_resolution', 'Analysis failed: No contract found');
    throw new AnalyzerResolutionError(intent, logs);
  }

  if (!canUseEvmPipeline(intent)) {
    log('warning', 'rpc', `RPC Provider Selection skipped for non-EVM chain: ${intent.chain}`);
    log('warning', 'contract_resolution', 'Contract inspection partially completed: non-EVM analyzer fallback used');
    const analysisDurationMs = Date.now() - startedAt;
    const providerUsed = selectedProviderFromChain(params.input, intent, telemetry.providerChain);
    const result = {
      intent,
      metadata: {
        name: intent.collectionName ?? 'Resolved Collection',
        symbol: intent.chain.toUpperCase(),
        totalSupply: '0',
        tokenStandard: 'Unknown' as const,
        owner: intent.contractAddress,
      },
      mintState: { status: 'UNKNOWN' as const },
      requirements: { mintFunction: 'unknown', mintPrice: '0' },
      mintFunction: {
        functionName: 'unknown',
        selector: 'unknown',
        confidence: 0,
      },
      analyzerPreferences: {
        autoDetectSocials: settings.autoDetectSocials,
        autoDetectContractInfo: settings.autoDetectContractInfo,
        autoDetectMintDetails: settings.autoDetectMintDetails,
        riskAnalysisEnabled: settings.riskAnalysisEnabled,
        aiSummaryEnabled: settings.aiSummaryEnabled,
      },
      providerChain: telemetry.providerChain,
      providerUsed,
      rpcProviderUsed: null,
      rpcProviders: [],
      analysisDurationMs,
      timingBreakdown: telemetry.timingBreakdown,
      logs,
      analyzedAt: new Date().toISOString(),
    };
    const scores = runTimed(telemetry.timingBreakdown, 'Score Calculation', async () => deriveAnalyzerScores(result));
    const resolvedScores = await scores;
    log('info', 'scoring', 'Calculating risk');
    log('success', 'scoring', `Risk score: ${resolvedScores.risk}`);
    log('info', 'scoring', 'Calculating opportunity');
    log('success', 'scoring', `Opportunity score: ${resolvedScores.opportunity}`);
    log('info', 'scoring', 'Calculating readiness');
    log('success', 'scoring', `Readiness: ${resolvedScores.readiness}%`);
    result.analysisDurationMs = Date.now() - startedAt;
    result.timingBreakdown.push({ stage: 'Total Duration', durationMs: result.analysisDurationMs });
    const historyId = await saveAnalyzerHistory({
      userId: params.userId,
      input: params.input,
      result,
      scores: resolvedScores,
      analysisDurationMs: result.analysisDurationMs,
    });
    log('success', 'history', 'Analyzer history saved');
    log('success', 'history', `History record id: ${historyId}`);
    log('success', 'completion', `Total analysis duration: ${result.analysisDurationMs}ms`);
    log('warning', 'completion', 'Analysis partially completed');
    return result;
  }

  log('info', 'rpc', 'Checking RPC provider latency');
  const rpcSnapshot = await refreshRpcProviderLatency(params.userId, intent.chain);
  log('info', 'rpc', 'RPC Provider Selection');
  const rpcProviderUsed = rpcProviderLabel(rpcSnapshot.currentActiveProvider);
  for (const provider of rpcSnapshot.providers) {
    const providerName = provider.provider === 'ALCHEMY' ? 'Alchemy' : 'QuickNode';
    log(
      provider.configured && provider.healthy ? 'success' : 'warning',
      'rpc',
      provider.configured
        ? `${providerName} ${provider.healthy ? 'succeeded' : 'failed'}${provider.latency !== null ? ` latency: ${provider.latency}ms` : ''}`
        : `${providerName} not configured`,
    );
  }
  if (rpcSnapshot.currentActiveProvider) {
    const selectedProvider = rpcSnapshot.providers.find((provider) => provider.provider === rpcSnapshot.currentActiveProvider);
    log('success', 'rpc', `Selected ${rpcProviderUsed}`);
    log('success', 'rpc', `${rpcProviderUsed} selected${selectedProvider?.latency !== null && selectedProvider?.latency !== undefined ? ` (${selectedProvider.latency}ms latency)` : ''}`);
  }
  const rpcProviders = rpcSnapshot.providers.map((provider) => ({
    provider: provider.provider === 'ALCHEMY' ? 'Alchemy' : 'QuickNode',
    selected: provider.provider === rpcSnapshot.currentActiveProvider,
    configured: provider.configured,
    healthy: provider.healthy,
    latencyMs: provider.latency,
    status: provider.status,
  }));

  const contractAddress = intent.contractAddress;
  const chain = intent.chain;

  const [metadata, mintState, requirements, discoveredAbi] = await Promise.all([
    settings.autoDetectContractInfo
      ? runLogged(
          log,
          'metadata',
          'Fetching collection metadata',
          (value) => `Collection metadata loaded: ${value.name}`,
          () => runTimed(telemetry.timingBreakdown, 'Metadata Fetch', () => getCollectionMetadata(contractAddress, chain)),
        )
      : Promise.resolve({
          name: 'Unknown Collection',
          symbol: 'UNKNOWN',
          totalSupply: BigInt(0),
          tokenStandard: 'Unknown' as const,
          owner: intent.contractAddress,
        }),
    settings.autoDetectMintDetails
      ? runLogged(
          log,
          'metadata',
          'Inspecting contract mint state',
          (value) => `Mint state loaded: ${value.status}`,
          () => runTimed(telemetry.timingBreakdown, 'Mint State Detection', () => getMintState(contractAddress, chain)),
        )
      : Promise.resolve({ status: 'UNKNOWN' as const }),
    settings.autoDetectMintDetails
      ? runLogged(
          log,
          'mint_discovery',
          'Fetching mint requirements',
          (value) => `Mint requirements loaded: ${value.mintFunction}`,
          () => runTimed(telemetry.timingBreakdown, 'Mint Requirements', () => fetchMintRequirements(contractAddress, chain)),
        )
      : Promise.resolve({ mintFunction: 'mint', mintPrice: '0' }),
    settings.autoDetectContractInfo
      ? runLogged(
          log,
          'mint_discovery',
          'Inspecting contract ABI',
          (value) => `ABI discovered from ${value.source}`,
          () => runTimed(telemetry.timingBreakdown, 'ABI Discovery', () => discoverContractABI(contractAddress, chain)),
        )
      : Promise.resolve({ abi: [], source: 'fallback' as const, confidence: 0 }),
  ]);

  const mintFunction = settings.autoDetectContractInfo
    ? await runTimed(telemetry.timingBreakdown, 'Mint Function Discovery', async () => discoverMintFunction(discoveredAbi.abi))
    : { functionName: 'mint', selector: 'mint(uint256)', confidence: 0 };
  log('success', 'metadata', `Owner detected: ${metadata.owner}`);
  log('success', 'metadata', `Supply detected: ${metadata.totalSupply.toString()}`);
  log('success', 'mint_discovery', `Mint function discovered: ${mintFunction.functionName}`);

  if (settings.autoDetectSocials) {
    log('warning', 'social_discovery', 'Social discovery skipped: no analyzer social provider executed');
  }

  const providerUsed = selectedProviderFromChain(params.input, intent, telemetry.providerChain);
  const result = {
    intent,
    metadata: {
      ...metadata,
      totalSupply: metadata.totalSupply.toString(),
    },
    mintState,
    requirements,
    mintFunction,
    analyzerPreferences: {
      autoDetectSocials: settings.autoDetectSocials,
      autoDetectContractInfo: settings.autoDetectContractInfo,
      autoDetectMintDetails: settings.autoDetectMintDetails,
      riskAnalysisEnabled: settings.riskAnalysisEnabled,
      aiSummaryEnabled: settings.aiSummaryEnabled,
    },
    providerChain: telemetry.providerChain,
    providerUsed,
    rpcProviderUsed,
    rpcProviders,
    analysisDurationMs: 0,
    timingBreakdown: telemetry.timingBreakdown,
    logs,
    analyzedAt: new Date().toISOString(),
  };

  const scores = await runTimed(telemetry.timingBreakdown, 'Score Calculation', async () => deriveAnalyzerScores(result));
  log('info', 'scoring', 'Calculating readiness');
  log('success', 'scoring', `Readiness: ${scores.readiness}%`);
  log('info', 'scoring', 'Calculating risk');
  log('success', 'scoring', `Risk score: ${scores.risk}`);
  log('info', 'scoring', 'Calculating opportunity');
  log('success', 'scoring', `Opportunity score: ${scores.opportunity}`);
  result.analysisDurationMs = Date.now() - startedAt;
  result.timingBreakdown.push({ stage: 'Total Duration', durationMs: result.analysisDurationMs });

  const historyId = await saveAnalyzerHistory({
    userId: params.userId,
    input: params.input,
    result,
    scores,
    analysisDurationMs: result.analysisDurationMs,
  });
  log('success', 'history', 'Analyzer history saved');
  log('success', 'history', `History record id: ${historyId}`);
  log('success', 'completion', `Total analysis duration: ${result.analysisDurationMs}ms`);

  if (settings.aiSummaryEnabled) {
    log('warning', 'ai_summary', 'AI summary skipped: no analyzer summary generator executed');
  }

  addBreadcrumb({
    category: 'discovery',
    message: 'discovery completed',
    level: 'info',
    data: {
      url: normalizedInput,
      userId: params.userId,
      contractAddress: intent.contractAddress,
      chain: intent.chain,
    },
  });

  if ((params.notify ?? true) && settings.riskAnalysisEnabled) {
    await sendTelegramNotification(params.userId, 'risk_analysis_complete', {
      url: params.input,
      collectionName: metadata.name ?? undefined,
      contractAddress: intent.contractAddress,
      confidence: intent.confidence,
    });

    if (!intent.isValid || intent.confidence < 0.55 || mintFunction.confidence < 0.55 || mintState.status === 'UNKNOWN') {
      await sendTelegramNotification(params.userId, 'high_risk_collection', {
        url: params.input,
        collectionName: metadata.name ?? undefined,
        contractAddress: intent.contractAddress,
        riskReason: 'Low confidence or unknown mint state',
      });
    }
  }

  log('success', 'completion', 'Analysis completed');
    return result;
  } catch (error) {
    if (error instanceof AnalyzerResolutionError || error instanceof AnalyzerExecutionError) throw error;
    log('error', 'completion', `Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AnalyzerExecutionError(error instanceof Error ? error.message : 'Analyzer request failed', logs);
  }
}
