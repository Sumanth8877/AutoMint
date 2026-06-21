import 'server-only';

import { getCollectionMetadata, type CollectionMetadata } from '@/lib/blockchain/collections';
import { resolveMintIntent, type MintIntent } from '@/lib/resolve-mint-intent';
import { addBreadcrumb } from '@/lib/observability/sentry';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';
import { fetchMintRequirements, type MintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState, type MintState } from '@/lib/services/mint-state.service';
import { sendTelegramNotification } from '@/lib/services/telegram.service';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';

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
  analyzedAt: string;
};

export class AnalyzerResolutionError extends Error {
  status = 422;
  intent: MintIntent;

  constructor(intent: MintIntent) {
    super('Could not resolve a contract address from that URL yet.');
    this.name = 'AnalyzerResolutionError';
    this.intent = intent;
  }
}

export function normalizeAnalyzerInput(input: string) {
  const trimmed = input.trim();
  return trimmed.startsWith('0x') ? `https://etherscan.io/address/${trimmed}` : trimmed;
}

export async function runAnalyzer(params: {
  userId: string;
  input: string;
  settings?: AnalyzerSettings;
  notify?: boolean;
}): Promise<AnalyzerResult> {
  const normalizedInput = normalizeAnalyzerInput(params.input);
  const settings = params.settings ?? await getEffectiveExecutionDefaults(params.userId);

  addBreadcrumb({
    category: 'discovery',
    message: 'URL submitted',
    level: 'info',
    data: { url: normalizedInput, userId: params.userId },
  });

  const intent = await resolveMintIntent(normalizedInput);
  if (!intent.contractAddress) {
    throw new AnalyzerResolutionError(intent);
  }

  const [metadata, mintState, requirements, discoveredAbi] = await Promise.all([
    settings.autoDetectContractInfo
      ? getCollectionMetadata(intent.contractAddress, intent.chain)
      : Promise.resolve({
          name: 'Unknown Collection',
          symbol: 'UNKNOWN',
          totalSupply: BigInt(0),
          tokenStandard: 'Unknown' as const,
          owner: intent.contractAddress,
        }),
    settings.autoDetectMintDetails
      ? getMintState(intent.contractAddress, intent.chain)
      : Promise.resolve({ status: 'UNKNOWN' as const }),
    settings.autoDetectMintDetails
      ? fetchMintRequirements(intent.contractAddress, intent.chain)
      : Promise.resolve({ mintFunction: 'mint', mintPrice: '0' }),
    settings.autoDetectContractInfo
      ? discoverContractABI(intent.contractAddress, intent.chain)
      : Promise.resolve({ abi: [], source: 'fallback' as const, confidence: 0 }),
  ]);

  const mintFunction = settings.autoDetectContractInfo
    ? discoverMintFunction(discoveredAbi.abi)
    : { functionName: 'mint', selector: 'mint(uint256)', confidence: 0 };

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
    analyzedAt: new Date().toISOString(),
  };

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

  return result;
}
