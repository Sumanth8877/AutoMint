import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { fanoutMintFromUrl } from '@/lib/services/mint-fanout.service';
import { fanoutSchema, formatZodError } from '@/lib/api/schemas';
import { parseJsonBody } from '@/lib/api/errors';

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

  const rawBody = await parseJsonBody(req);
  const parsed = fanoutSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const { mintUrl, walletIds, quantity, privateMempool, overrideRisk, maxRetries } = parsed.data;

  try {
    const result = await fanoutMintFromUrl(
      mintUrl.trim(),
      walletIds,
      authResult.userId,
      { quantity, privateMempool, overrideRisk, maxRetries },
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Fanout failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
