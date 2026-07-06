import 'server-only';

import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/require-auth';
import { parseAbi } from 'viem';
import { getClient } from '@/lib/blockchain/client';
import { logger } from '@/lib/logger';

type MintStatus = 'LIVE' | 'NOT_STARTED' | 'PAUSED' | 'ENDED' | 'UNKNOWN';

// Common ABI fragments found across popular NFT launchpads
const STATUS_ABI = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function MAX_SUPPLY() view returns (uint256)',
  'function saleIsActive() view returns (bool)',
  'function mintingEnabled() view returns (bool)',
  'function paused() view returns (bool)',
  'function publicSaleActive() view returns (bool)',
  'function saleStarted() view returns (bool)',
]);

// Soft probe — returns null instead of throwing if the function doesn't exist
async function probe<T>(
  client: ReturnType<typeof getClient>,
  address: `0x${string}`,
  functionName: string,
): Promise<T | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await client.readContract({ address, abi: STATUS_ABI, functionName: functionName as any }) as T;
  } catch {
    return null; // function doesn't exist on this contract
  }
}

export async function GET(req: Request) {
  const authResult = await requireApiSession();
  if ('error' in authResult) return authResult.error;

  const { searchParams } = new URL(req.url);
  const contractAddress = searchParams.get('contractAddress') as `0x\${string}` | null;
  const chain = searchParams.get('chain');

  if (!contractAddress || !chain) {
    return NextResponse.json({ error: 'Contract address and chain are required' }, { status: 400 });
  }

  if (!contractAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    return NextResponse.json({ error: 'Invalid contract address format' }, { status: 400 });
  }

  try {
    const client = getClient(chain);

    // Probe all standard mint-status signals in parallel
    const [
      totalSupply, maxSupply, MAX_SUPPLY,
      saleIsActive, mintingEnabled, paused,
      publicSaleActive, saleStarted,
    ] = await Promise.all([
      probe<bigint>(client, contractAddress, 'totalSupply'),
      probe<bigint>(client, contractAddress, 'maxSupply'),
      probe<bigint>(client, contractAddress, 'MAX_SUPPLY'),
      probe<boolean>(client, contractAddress, 'saleIsActive'),
      probe<boolean>(client, contractAddress, 'mintingEnabled'),
      probe<boolean>(client, contractAddress, 'paused'),
      probe<boolean>(client, contractAddress, 'publicSaleActive'),
      probe<boolean>(client, contractAddress, 'saleStarted'),
    ]);

    const resolvedMax = maxSupply ?? MAX_SUPPLY;

    let status: MintStatus = 'UNKNOWN';
    let reason = 'no_status_function_found';

    // Priority 1: sold out (supply check — highest confidence)
    if (totalSupply !== null && resolvedMax !== null && resolvedMax > 0n && totalSupply >= resolvedMax) {
      status = 'ENDED'; reason = 'sold_out';
    }
    // Priority 2: paused
    else if (paused === true) {
      status = 'PAUSED'; reason = 'contract_paused';
    }
    // Priority 3: explicit LIVE signals
    else if (saleIsActive === true || mintingEnabled === true || publicSaleActive === true || saleStarted === true) {
      status = 'LIVE'; reason = 'sale_active';
    }
    // Priority 4: explicit NOT_STARTED signals
    else if (saleIsActive === false || mintingEnabled === false || publicSaleActive === false) {
      status = 'NOT_STARTED'; reason = 'sale_inactive';
    }

    logger.info('Probed contract status', { area: 'mint-status',  chain, status, reason, contractAddress });

    return NextResponse.json({
      status,
      reason,
      totalSupply: totalSupply?.toString() ?? null,
      maxSupply: resolvedMax?.toString() ?? null,
    });

  } catch (error) {
    return NextResponse.json({
      status: 'UNKNOWN' as MintStatus,
      reason: 'rpc_error',
      totalSupply: null,
      maxSupply: null,
    });
  }
}
