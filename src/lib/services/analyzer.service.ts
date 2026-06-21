import 'server-only';

import { getCollectionMetadata, type CollectionMetadata } from '@/lib/blockchain/collections';
import { resolveMintIntent, type AnalyzerDebugLogEntry, type AnalyzerDebugLogLevel, type MintIntent } from '@/lib/resolve-mint-intent';
import { addBreadcrumb } from '@/lib/observability/sentry';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';
import { fetchMintRequirements, type MintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState, type MintState } from '@/lib/services/mint-state.service';
import { sendTelegramNotification } from '@/lib/services/telegram.service';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';
import { getRpcRoutingSnapshot } from '@/lib/services/rpc-manager.service';

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

function deriveAnalyzerScores(result: Pick<AnalyzerResult, 'intent' | 'mintFunction' | 'mintState'>) {
  const confidence = Math.round(result.intent.confidence * 100);
  const functionConfidence = Math.round(result.mintFunction.confidence * 100);
  const liveBonus = result.mintState.status === 'LIVE' ? 12 : 0;
  const readiness = Math.min(96, Math.max(24, Math.round((confidence + functionConfidence) / 2) + liveBonus));
  const risk = Math.max(12, 100 - readiness);
  const opportunity = Math.min(98, Math.max(30, readiness - risk / 4));

  return { opportunity: Math.round(opportunity), risk: Math.round(risk), readiness };
}

export async function runAnalyzer(params: {
  userId: string;
  input: string;
  settings?: AnalyzerSettings;
  notify?: boolean;
}): Promise<AnalyzerResult> {
  const logger = createAnalyzerLogger();
  const { log, logs } = logger;
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

  const intent = await resolveMintIntent(normalizedInput, (entry) => log(entry.level, entry.stage, entry.message));
  if (!intent.contractAddress) {
    log('error', 'contract_resolution', 'Analysis failed: No contract found');
    throw new AnalyzerResolutionError(intent, logs);
  }

  if (!canUseEvmPipeline(intent)) {
    log('warning', 'rpc', `RPC Provider Selection skipped for non-EVM chain: ${intent.chain}`);
    log('warning', 'contract_inspection', 'Contract inspection partially completed: non-EVM analyzer fallback used');
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
      logs,
      analyzedAt: new Date().toISOString(),
    };
    const scores = deriveAnalyzerScores(result);
    log('info', 'scoring', 'Running risk engine');
    log('success', 'scoring', `Risk score: ${scores.risk}`);
    log('info', 'scoring', 'Running opportunity engine');
    log('success', 'scoring', `Opportunity score: ${scores.opportunity}`);
    log('success', 'scoring', `Readiness: ${scores.readiness}%`);
    log('warning', 'final_status', 'Analysis partially completed');
    return result;
  }

  const rpcSnapshot = await getRpcRoutingSnapshot(params.userId, intent.chain);
  log('info', 'rpc', 'RPC Provider Selection');
  for (const provider of rpcSnapshot.providers) {
    log(
      provider.configured && provider.healthy ? 'success' : 'warning',
      'rpc',
      `${provider.provider} ${provider.configured ? provider.status.toLowerCase() : 'not configured'}${provider.latency !== null ? ` latency: ${provider.latency}ms` : ''}`,
    );
  }
  if (rpcSnapshot.currentActiveProvider) {
    log('success', 'rpc', `Selected ${rpcSnapshot.currentActiveProvider}`);
  }

  const contractAddress = intent.contractAddress;
  const chain = intent.chain;

  const [metadata, mintState, requirements, discoveredAbi] = await Promise.all([
    settings.autoDetectContractInfo
      ? runLogged(
          log,
          'contract_inspection',
          'Fetching collection metadata',
          (value) => `${value.tokenStandard} detected`,
          () => getCollectionMetadata(contractAddress, chain),
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
          'contract_inspection',
          'Inspecting contract mint state',
          (value) => `Mint state detected: ${value.status}`,
          () => getMintState(contractAddress, chain),
        )
      : Promise.resolve({ status: 'UNKNOWN' as const }),
    settings.autoDetectMintDetails
      ? runLogged(
          log,
          'contract_inspection',
          'Fetching mint requirements',
          (value) => `Mint requirements fetched: ${value.mintFunction}`,
          () => fetchMintRequirements(contractAddress, chain),
        )
      : Promise.resolve({ mintFunction: 'mint', mintPrice: '0' }),
    settings.autoDetectContractInfo
      ? runLogged(
          log,
          'contract_inspection',
          'Inspecting contract ABI',
          (value) => `Contract ABI discovery completed from ${value.source}`,
          () => discoverContractABI(contractAddress, chain),
        )
      : Promise.resolve({ abi: [], source: 'fallback' as const, confidence: 0 }),
  ]);

  const mintFunction = settings.autoDetectContractInfo
    ? discoverMintFunction(discoveredAbi.abi)
    : { functionName: 'mint', selector: 'mint(uint256)', confidence: 0 };
  log('success', 'contract_inspection', `Mint function selected: ${mintFunction.functionName}`);

  if (settings.autoDetectSocials) {
    log('warning', 'social_discovery', 'Social discovery skipped: no analyzer social provider executed');
  }

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
    logs,
    analyzedAt: new Date().toISOString(),
  };

  const scores = deriveAnalyzerScores(result);
  log('info', 'scoring', 'Running risk engine');
  log('success', 'scoring', `Risk score: ${scores.risk}`);
  log('info', 'scoring', 'Running opportunity engine');
  log('success', 'scoring', `Opportunity score: ${scores.opportunity}`);
  log('info', 'scoring', 'Calculating readiness');
  log('success', 'scoring', `Readiness: ${scores.readiness}%`);

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

  log('success', 'final_status', 'Analysis completed successfully');
  return result;
}
