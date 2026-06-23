import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { fanoutMintFromUrl } from '@/lib/services/mint-fanout.service';

/**
 * POST /api/mints/fanout
 *
 * Schedule a simultaneous mint across multiple wallets for the same contract.
 *
 * All N wallets receive their QStash execution message at the same instant,
 * maximising the probability of landing in the same block.
 *
 * Body:
 *   mintUrl   string    — NFT mint page URL
 *   walletIds string[]  — 1–50 wallet IDs (must belong to the authenticated user)
 *   quantity  number    — tokens to mint per wallet (default: 1)
 *   privateMempool boolean — route via Flashbots/MEV Blocker (Ethereum only, default: false)
 *   overrideRisk boolean  — skip risk gate (default: false)
 *   maxRetries number     — per-task retry budget (default: 20)
 *
 * Response:
 *   contractAddress string
 *   chain           string
 *   mintState       'LIVE' | 'PENDING' | 'ENDED'
 *   totalWallets    number
 *   scheduled       number
 *   skipped         number
 *   errors          number
 *   wallets         FanoutWalletResult[]
 */
export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const body = await req.json() as {
    mintUrl?: string;
    walletIds?: string[];
    quantity?: number;
    privateMempool?: boolean;
    overrideRisk?: boolean;
    maxRetries?: number;
  };

  const { mintUrl, walletIds, quantity, privateMempool, overrideRisk, maxRetries } = body;

  if (!mintUrl?.trim()) {
    return NextResponse.json({ error: 'mintUrl is required' }, { status: 400 });
  }

  if (!Array.isArray(walletIds) || walletIds.length === 0) {
    return NextResponse.json({ error: 'walletIds must be a non-empty array' }, { status: 400 });
  }

  if (walletIds.length > 50) {
    return NextResponse.json({ error: 'Maximum 50 wallets per fanout' }, { status: 400 });
  }

  try {
    const result = await fanoutMintFromUrl(
      mintUrl.trim(),
      walletIds,
      authResult.userId,
      { quantity: quantity ?? 1, privateMempool: privateMempool ?? false, overrideRisk: overrideRisk ?? false, maxRetries: maxRetries ?? 20 },
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fanout failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
