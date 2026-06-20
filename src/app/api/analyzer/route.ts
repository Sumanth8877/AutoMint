import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getCollectionMetadata } from '@/lib/blockchain/collections';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';
import { parseJsonBody } from '@/lib/api/errors';
import { sendTelegramNotification } from '@/lib/services/telegram.service';

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
    const intent = await resolveMintIntent(normalizedInput);

    if (!intent.contractAddress) {
      return NextResponse.json({
        error: 'Could not resolve a contract address from that URL yet.',
        intent,
      }, { status: 422 });
    }

    const [metadata, mintState, requirements, discoveredAbi] = await Promise.all([
      getCollectionMetadata(intent.contractAddress, intent.chain),
      getMintState(intent.contractAddress, intent.chain),
      fetchMintRequirements(intent.contractAddress, intent.chain),
      discoverContractABI(intent.contractAddress, intent.chain),
    ]);
    const mintFunction = discoverMintFunction(discoveredAbi.abi);

    const response = {
      intent,
      metadata: {
        ...metadata,
        totalSupply: metadata.totalSupply.toString(),
      },
      mintState,
      requirements,
      mintFunction,
      analyzedAt: new Date().toISOString(),
    };

    await sendTelegramNotification(authResult.userId, 'risk_analysis_complete', {
      url: input,
      collectionName: metadata.name,
      contractAddress: intent.contractAddress,
      confidence: intent.confidence,
    });

    if (!intent.isValid || intent.confidence < 0.55 || mintFunction.confidence < 0.55 || mintState.status === 'UNKNOWN') {
      await sendTelegramNotification(authResult.userId, 'high_risk_collection', {
        url: input,
        collectionName: metadata.name,
        contractAddress: intent.contractAddress,
        riskReason: 'Low confidence or unknown mint state',
      });
    }

    return NextResponse.json(response);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
