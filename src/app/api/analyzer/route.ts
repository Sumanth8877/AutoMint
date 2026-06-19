import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/require-auth';
import { getCollectionMetadata } from '@/lib/blockchain/collections';
import { discoverContractABI, discoverMintFunction } from '@/lib/services/mint-abi-discovery.service';
import { fetchMintRequirements } from '@/lib/services/mint-requirements.service';
import { getMintState } from '@/lib/services/mint-state.service';
import { resolveMintIntent } from '@/lib/resolve-mint-intent';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Analyzer request failed';
}

export async function POST(req: Request) {
  const authResult = await requireApiSession();
  if ('error' in authResult) return authResult.error;

  const body = await req.json() as { input?: string };
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

  try {
    const [metadata, mintState, requirements, discoveredAbi] = await Promise.all([
      getCollectionMetadata(intent.contractAddress, intent.chain),
      getMintState(intent.contractAddress, intent.chain),
      fetchMintRequirements(intent.contractAddress, intent.chain),
      discoverContractABI(intent.contractAddress, intent.chain),
    ]);
    const mintFunction = discoverMintFunction(discoveredAbi.abi);

    return NextResponse.json({
      intent,
      metadata: {
        ...metadata,
        totalSupply: metadata.totalSupply.toString(),
      },
      mintState,
      requirements,
      mintFunction,
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error), intent }, { status: 500 });
  }
}
