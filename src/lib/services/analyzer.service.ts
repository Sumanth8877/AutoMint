import 'server-only';

// ── analyzer.service.ts (orchestrator) ───────────────────────────────────────
// Thin coordinator: resolves intent → fetches on-chain data → runs risk →
// persists history → notifies. All heavy logic lives in:
//   • analyzer-resolver.service.ts  (URL resolution, social discovery)
//   • analyzer-data.service.ts      (Moralis / GoPlus / risk)
// ─────────────────────────────────────────────────────────────────────────────

import {
  type MintIntent,
  type AnalyzerResolutionTelemetry,
  type AnalyzerProviderAttempt,
} from '@/lib/resolve-mint-intent';
import { createAnalyzerCacheStats } from '@/lib/services/analyzer-cache.service';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';
import { fetchMintRequirements, type MintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState, type MintState } from '@/lib/services/mint-state.service';
import { sendTelegramNotification } from '@/lib/services/telegram.service';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { refreshRpcProviderLatency } from '@/lib/services/rpc-manager.service';
import { type AnalyzerRiskAnalysis } from '@/lib/services/risk.service';
import { type AnalyzerCollectionIntelligence } from '@/lib/services/analyzer-market-intelligence.service';

import {
  normalizeAnalyzerInput,
  detectInputType,
  canUseEvmPipeline,
  createAnalyzerLogger,
  runLogged,
  runTimed,
  resolveIntentWithCache,
  getSocialHealth,
  type AnalyzerSocials,
  type AnalyzerSocialKey,
  type AnalyzerDebugLogEntry,
  type AnalyzerDebugLogLevel,
  type AnalyzerTiming,
} from '@/lib/services/analyzer-resolver.service';

import {
  getCachedCollectionMetadata,
  runBlockchainDiscoveryWithCache,
  fetchCollectionIntelligenceWithCache,
  runAnalyzerRisk,
  saveAnalyzerHistorySafely,
  deriveAnalyzerScores,
  derivePerformanceMetrics,
  selectedProviderFromChain,
  rpcProviderLabel,
  type AnalyzerPerformanceMetrics,
} from '@/lib/services/analyzer-data.service';

// ── Public types ──────────────────────────────────────────────────────────────

export type { AnalyzerSocials };

// Re-export for callers that import normalizeAnalyzerInput from this module
export { normalizeAnalyzerInput } from '@/lib/services/analyzer-resolver.service';

type AnalyzerSocialHealth = { detectedCount: number; missing: AnalyzerSocialKey[] };
type AnalyzerSettings = Awaited<ReturnType<typeof getEffectiveExecutionDefaults>>;

export type AnalyzerResult = {
  intent: MintIntent;
  metadata: { name: string; symbol: string; totalSupply: string; tokenStandard: string; owner: string | null; [key: string]: unknown };
  mintState: MintState;
  requirements: MintRequirements;
  mintFunction: { functionName: string; selector: string; confidence: number };
  analyzerPreferences: { autoDetectSocials: boolean; autoDetectContractInfo: boolean; autoDetectMintDetails: boolean; riskAnalysisEnabled: boolean };
  riskAnalysis: AnalyzerRiskAnalysis;
  collectionIntelligence: AnalyzerCollectionIntelligence;
  socials: AnalyzerSocials;
  socialHealth: AnalyzerSocialHealth;
  providerChain: AnalyzerProviderAttempt[];
  providerUsed: string;
  cacheUsed: boolean;
  performanceMetrics: AnalyzerPerformanceMetrics;
  rpcProviderUsed: string | null;
  rpcProviders: Array<{ provider: string; selected: boolean; configured: boolean; healthy: boolean; latencyMs: number | null; status: string }>;
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

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runAnalyzer(params: {
  userId: string;
  input: string;
  settings?: AnalyzerSettings;
  notify?: boolean;
  onLog?: (entry: AnalyzerDebugLogEntry) => void;
}): Promise<AnalyzerResult> {
  const logger = createAnalyzerLogger(params.onLog);
  const { log, logs } = logger;
  const startedAt = Date.now();
  const cacheStats = createAnalyzerCacheStats();
  const telemetry: AnalyzerResolutionTelemetry = { providerChain: [], timingBreakdown: [] };

  try {
    const normalizedInput = normalizeAnalyzerInput(params.input);
    const settings = params.settings ?? await getEffectiveExecutionDefaults(params.userId);

    log('info', 'input', 'Analysis started');
    log('info', 'input', `Input received: ${params.input}`);
    log('success', 'input', `Input type detected: ${detectInputType(params.input)}`);

    // ── Step 1: Resolve intent ──────────────────────────────────────────────
    const intent = await resolveIntentWithCache({ normalizedInput,
      logger: (entry) => log(entry.level, entry.stage, entry.message),
      telemetry, cacheStats, log });

    if (!intent.contractAddress) {
      log('error', 'contract_resolution', 'Analysis failed: No contract found');
      throw new AnalyzerResolutionError(intent, logs);
    }

    // ── Step 2: Non-EVM fast path ───────────────────────────────────────────
    if (!canUseEvmPipeline(intent)) {
      return await runNonEvmPath({ params, intent, settings, cacheStats, telemetry, logs, log, startedAt });
    }

    // ── Step 3: RPC provider selection ─────────────────────────────────────
    log('info', 'rpc', 'Checking RPC provider latency');
    const rpcSnapshot = await refreshRpcProviderLatency(params.userId, intent.chain);
    log('info', 'rpc', 'RPC Provider Selection');
    const rpcProviderUsed = rpcProviderLabel(rpcSnapshot.currentActiveProvider);
    for (const provider of rpcSnapshot.providers) {
      const providerName = rpcProviderLabel(provider.provider) ?? provider.provider;
      log(provider.configured && provider.healthy ? 'success' : 'warning', 'rpc',
        provider.configured
          ? `${providerName} ${provider.healthy ? 'succeeded' : 'failed'}${provider.latency !== null ? ` latency: ${provider.latency}ms` : ''}`
          : `${providerName} not configured`);
    }
    if (rpcSnapshot.currentActiveProvider) {
      const sel = rpcSnapshot.providers.find((p) => p.provider === rpcSnapshot.currentActiveProvider);
      log('success', 'rpc', `Selected ${rpcProviderUsed}`);
      log('success', 'rpc', `${rpcProviderUsed} selected${sel?.latency != null ? ` (${sel.latency}ms latency)` : ''}`);
    }
    const rpcProviders = rpcSnapshot.providers.map((p) => ({
      provider: rpcProviderLabel(p.provider) ?? p.provider,
      selected: p.provider === rpcSnapshot.currentActiveProvider,
      configured: p.configured, healthy: p.healthy, latencyMs: p.latency, status: p.status,
    }));

    const { contractAddress, chain } = intent;

    // ── Step 4: Parallel on-chain data fetch ────────────────────────────────
    const [metadata, mintState, requirements, discoveredAbi] = await Promise.all([
      settings.autoDetectContractInfo
        ? runLogged(log, 'metadata', 'Fetching collection metadata',
            (v) => `Collection metadata loaded: ${v.name}`,
            () => runTimed(telemetry.timingBreakdown, 'Metadata Fetch',
              () => getCachedCollectionMetadata({ contractAddress, chain, cacheStats, log })))
        : Promise.resolve({ name: 'Unknown Collection', symbol: 'UNKNOWN', totalSupply: BigInt(0), tokenStandard: 'Unknown' as const, owner: intent.contractAddress ?? '' }),
      settings.autoDetectMintDetails
        ? runLogged(log, 'metadata', 'Inspecting contract mint state',
            (v) => `Mint state loaded: ${v.status}`,
            () => runTimed(telemetry.timingBreakdown, 'Mint State Detection', () => getMintState(contractAddress, chain)))
        : Promise.resolve({ status: 'UNKNOWN' as const }),
      settings.autoDetectMintDetails
        ? runLogged(log, 'mint_discovery', 'Fetching mint requirements',
            (v) => `Mint requirements loaded: ${v.mintFunction}`,
            () => runTimed(telemetry.timingBreakdown, 'Mint Requirements', () => fetchMintRequirements(contractAddress, chain)))
        : Promise.resolve({ mintFunction: 'mint', mintPrice: '0' }),
      settings.autoDetectContractInfo
        ? runLogged(log, 'mint_discovery', 'Inspecting contract ABI',
            (v) => `ABI discovered from ${v.source}`,
            () => runTimed(telemetry.timingBreakdown, 'ABI Discovery', () => discoverContractABI(contractAddress, chain)))
        : Promise.resolve({ abi: [], source: 'fallback' as const, confidence: 0 }),
    ]);

    const mintFunction = settings.autoDetectContractInfo
      ? await runTimed(telemetry.timingBreakdown, 'Mint Function Discovery', async () => discoverMintFunction(discoveredAbi.abi))
      : { functionName: 'mint', selector: 'mint(uint256)', confidence: 0 };

    log('success', 'metadata', `Owner detected: ${metadata.owner}`);
    log('success', 'metadata', `Supply detected: ${metadata.totalSupply.toString()}`);
    log('success', 'mint_discovery', `Mint function discovered: ${mintFunction.functionName}`);

    // ── Step 5: Social + blockchain discovery (parallel) ───────────────────
    // Social discovery removed — analyzer focuses purely on on-chain scam signals.
    const blockchainDiscovery = await runBlockchainDiscoveryWithCache({ contractAddress, chain, enabled: true, cacheStats, log, timingBreakdown: telemetry.timingBreakdown });
    const socialDiscovery = { socials: {} as AnalyzerSocials, socialHealth: getSocialHealth({}) };

    const collectionIntelligence = await fetchCollectionIntelligenceWithCache({
      intent, metadata: { ...metadata, totalSupply: metadata.totalSupply.toString() },
      cacheStats, log, timingBreakdown: telemetry.timingBreakdown,
    });

    const providerUsed = selectedProviderFromChain(params.input, intent, telemetry.providerChain);

    // ── Step 6: Risk analysis (incorporates GoPlus security) ───────────────
    const enhancedRiskFactors: string[] = [];
    if (blockchainDiscovery.securityCheck?.riskScore && blockchainDiscovery.securityCheck.riskScore > 0) {
      enhancedRiskFactors.push(...blockchainDiscovery.securityCheck.riskFactors);
      log('warning', 'security', `GoPlus Security detected ${blockchainDiscovery.securityCheck.riskFactors.length} risk factors`);
    }

    const riskAnalysis = await runAnalyzerRisk({
      userId: params.userId, contractAddress, chain,
      mintFunction: mintFunction.functionName, mintPrice: requirements.mintPrice,
      collectionName: metadata.name, owner: metadata.owner,
      tokenStandard: metadata.tokenStandard, totalSupply: metadata.totalSupply.toString(),
      collectionIntelligence, log,
      timingBreakdown: telemetry.timingBreakdown,
    });

    if (enhancedRiskFactors.length > 0) {
      riskAnalysis.riskFactors = [...new Set([...riskAnalysis.riskFactors, ...enhancedRiskFactors])];
      if (blockchainDiscovery.securityCheck && blockchainDiscovery.securityCheck.riskScore > 30) {
        riskAnalysis.riskScore = Math.min(100, riskAnalysis.riskScore + Math.floor(blockchainDiscovery.securityCheck.riskScore * 0.3));
        log('warning', 'security', `Risk score adjusted to ${riskAnalysis.riskScore} based on blockchain security analysis`);
      }
    }

    // ── Step 7: Build result + scores ──────────────────────────────────────
    const result: AnalyzerResult = {
      intent, metadata: { ...metadata, totalSupply: metadata.totalSupply.toString() },
      mintState, requirements, mintFunction,
      analyzerPreferences: { autoDetectSocials: settings.autoDetectSocials, autoDetectContractInfo: settings.autoDetectContractInfo, autoDetectMintDetails: settings.autoDetectMintDetails, riskAnalysisEnabled: settings.riskAnalysisEnabled },
      riskAnalysis, collectionIntelligence,
      socials: socialDiscovery.socials, socialHealth: socialDiscovery.socialHealth,
      providerChain: telemetry.providerChain, providerUsed, cacheUsed: cacheStats.hits > 0,
      performanceMetrics: derivePerformanceMetrics({ cacheStats, analysisDurationMs: 0, providerChain: telemetry.providerChain }),
      rpcProviderUsed, rpcProviders, analysisDurationMs: 0,
      timingBreakdown: telemetry.timingBreakdown, logs, analyzedAt: new Date().toISOString(),
    };

    const scores = await runTimed(telemetry.timingBreakdown, 'Score Calculation', async () => deriveAnalyzerScores(result));
    log('info', 'scoring', 'Calculating readiness');
    log('success', 'scoring', `Readiness: ${scores.readiness}%`);
    log('info', 'scoring', 'Calculating opportunity');
    log('success', 'scoring', `Opportunity score: ${scores.opportunity}`);

    result.analysisDurationMs = Date.now() - startedAt;
    result.performanceMetrics = derivePerformanceMetrics({ cacheStats, analysisDurationMs: result.analysisDurationMs, providerChain: result.providerChain });
    result.timingBreakdown.push({ stage: 'Total Duration', durationMs: result.analysisDurationMs });

    // ── Step 8: Persist + notify ────────────────────────────────────────────
    await saveAnalyzerHistorySafely({ userId: params.userId, input: params.input, result, scores, analysisDurationMs: result.analysisDurationMs }, log);
    log('success', 'completion', `Total analysis duration: ${result.analysisDurationMs}ms`);
    log('success', 'completion', `Total duration reduced with cache hit rate ${result.performanceMetrics.cacheHitRate}%`);

    if ((params.notify ?? true) && settings.riskAnalysisEnabled) {
      await sendTelegramNotification(params.userId, 'risk_analysis_complete', {
        url: params.input, collectionName: metadata.name ?? undefined,
        contractAddress: intent.contractAddress, confidence: intent.confidence,
      });
      if (!intent.isValid || intent.confidence < 0.55 || mintFunction.confidence < 0.55 || mintState.status === 'UNKNOWN') {
        await sendTelegramNotification(params.userId, 'high_risk_collection', {
          url: params.input, collectionName: metadata.name ?? undefined,
          contractAddress: intent.contractAddress, riskReason: 'Low confidence or unknown mint state',
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

// ── Non-EVM fast path (Solana / Magic Eden) ───────────────────────────────────

async function runNonEvmPath(params: {
  params: { userId: string; input: string; settings?: AnalyzerSettings; notify?: boolean; onLog?: (entry: AnalyzerDebugLogEntry) => void };
  intent: MintIntent;
  settings: AnalyzerSettings;
  cacheStats: ReturnType<typeof createAnalyzerCacheStats>;
  telemetry: AnalyzerResolutionTelemetry;
  logs: AnalyzerDebugLogEntry[];
  log: (level: AnalyzerDebugLogLevel, stage: string, message: string) => void;
  startedAt: number;
}): Promise<AnalyzerResult> {
  const { intent, settings, cacheStats, telemetry, logs, log, startedAt } = params;
  const p = params.params;

  log('warning', 'rpc', `RPC Provider Selection skipped for non-EVM chain: ${intent.chain}`);
  log('warning', 'contract_resolution', 'Contract inspection partially completed: non-EVM analyzer fallback used');

  const socialDiscovery = { socials: {} as AnalyzerSocials, socialHealth: getSocialHealth({}) };
  const fallbackMetadata = { name: intent.collectionName ?? 'Resolved Collection', symbol: intent.chain.toUpperCase(), totalSupply: '0', tokenStandard: 'Unknown' as const, owner: intent.contractAddress ?? '' };
  const collectionIntelligence = await fetchCollectionIntelligenceWithCache({
    intent, metadata: fallbackMetadata, cacheStats, log, timingBreakdown: telemetry.timingBreakdown,
  });
  const riskAnalysis = await runAnalyzerRisk({
    userId: p.userId, contractAddress: intent.contractAddress, chain: intent.chain,
    mintFunction: 'unknown', mintPrice: '0', collectionName: intent.collectionName ?? 'Resolved Collection',
    owner: intent.contractAddress ?? '', tokenStandard: 'Unknown', totalSupply: '0',
    collectionIntelligence, log, timingBreakdown: telemetry.timingBreakdown,
  });

  const result: AnalyzerResult = {
    intent, metadata: fallbackMetadata, mintState: { status: 'UNKNOWN' as const },
    requirements: { mintFunction: 'unknown', mintPrice: '0' },
    mintFunction: { functionName: 'unknown', selector: 'unknown', confidence: 0 },
    analyzerPreferences: { autoDetectSocials: settings.autoDetectSocials, autoDetectContractInfo: settings.autoDetectContractInfo, autoDetectMintDetails: settings.autoDetectMintDetails, riskAnalysisEnabled: settings.riskAnalysisEnabled },
    riskAnalysis, collectionIntelligence, socials: socialDiscovery.socials, socialHealth: socialDiscovery.socialHealth,
    providerChain: telemetry.providerChain, providerUsed: selectedProviderFromChain(p.input, intent, telemetry.providerChain),
    cacheUsed: cacheStats.hits > 0,
    performanceMetrics: derivePerformanceMetrics({ cacheStats, analysisDurationMs: 0, providerChain: telemetry.providerChain }),
    rpcProviderUsed: null, rpcProviders: [], analysisDurationMs: 0,
    timingBreakdown: telemetry.timingBreakdown, logs, analyzedAt: new Date().toISOString(),
  };

  const scores = await runTimed(telemetry.timingBreakdown, 'Score Calculation', async () => deriveAnalyzerScores(result));
  log('info', 'scoring', 'Calculating opportunity');
  log('success', 'scoring', `Opportunity score: ${scores.opportunity}`);
  log('info', 'scoring', 'Calculating readiness');
  log('success', 'scoring', `Readiness: ${scores.readiness}%`);
  result.analysisDurationMs = Date.now() - startedAt;
  result.performanceMetrics = derivePerformanceMetrics({ cacheStats, analysisDurationMs: result.analysisDurationMs, providerChain: result.providerChain });
  result.timingBreakdown.push({ stage: 'Total Duration', durationMs: result.analysisDurationMs });
  await saveAnalyzerHistorySafely({ userId: p.userId, input: p.input, result, scores, analysisDurationMs: result.analysisDurationMs }, log);
  log('success', 'completion', `Total analysis duration: ${result.analysisDurationMs}ms`);
  log('warning', 'completion', 'Analysis partially completed');
  return result;
}
