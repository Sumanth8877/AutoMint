import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getCollectionMetadata } from '@/lib/blockchain/collections';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { parseJsonBody } from '@/lib/api/errors';
import { sendTelegramNotification } from '@/lib/services/telegram.service';
import { addBreadcrumb, captureException } from '@/lib/observability/sentry';
import { getEffectiveExecutionDefaults } from '@/lib/services/execution-settings.service';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Analyzer request failed';
}

export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ input?: string }>(req);
    const input = body.input?.trim();

    if (!input) {
      return NextResponse.json({ error: 'Paste a launchpad URL or contract address to analyze.' }, { status: 400 });
    }

    const normalizedInput = input.startsWith('0x') ? `https://etherscan.io/address/${input}` : input;
    addBreadcrumb({ category: 'discovery', message: 'URL submitted', level: 'info', data: { url: normalizedInput, userId: authResult.userId } });
    const settings = await getEffectiveExecutionDefaults(authResult.userId);
    const intent = await resolveMintIntent(normalizedInput);

    if (!intent.contractAddress) {
      return NextResponse.json({
        error: 'Could not resolve a contract address from that URL yet.',
        intent,
      }, { status: 422 });
    }

    const [metadata, mintState, requirements, discoveredAbi] = await Promise.all([
      settings.autoDetectContractInfo
        ? getCollectionMetadata(intent.contractAddress, intent.chain)
        : Promise.resolve({ name: 'Unknown Collection', symbol: 'UNKNOWN', totalSupply: BigInt(0), tokenStandard: 'Unknown' as const, owner: intent.contractAddress }),
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

    const response = {
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
    addBreadcrumb({ category: 'discovery', message: 'discovery completed', level: 'info', data: { url: normalizedInput, userId: authResult.userId, contractAddress: intent.contractAddress, chain: intent.chain } });

    if (settings.riskAnalysisEnabled) {
      await sendTelegramNotification(authResult.userId, 'risk_analysis_complete', {
        url: input,
        collectionName: metadata.name ?? undefined,
        contractAddress: intent.contractAddress,
        confidence: intent.confidence,
      });

      if (!intent.isValid || intent.confidence < 0.55 || mintFunction.confidence < 0.55 || mintState.status === 'UNKNOWN') {
        await sendTelegramNotification(authResult.userId, 'high_risk_collection', {
          url: input,
          collectionName: metadata.name ?? undefined,
          contractAddress: intent.contractAddress,
          riskReason: 'Low confidence or unknown mint state',
        });
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === 'Invalid JSON request body' ? 400 : 500;
    if (status >= 500) {
      await captureException(error, {
        area: 'discovery',
        context: { route: '/api/analyzer' },
        fingerprint: ['analyzer', 'route'],
      });
    }
    return NextResponse.json({ error: message }, { status });
  }
}
