import { NextResponse } from 'next/server';
import { parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getCopyMintRules, upsertCopyMintRule } from '@/lib/services/copy-mint.service';

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const rules = await getCopyMintRules(authResult.userId);
    return NextResponse.json({ rules });
  } catch (error) {
    return handleRouteError(error, 'Failed to fetch copy-mint rules');
  }
}

export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{
      walletAddress?: string;
      maxPrice?: string | number | null;
      quantity?: string | number | null;
      minMintCount?: string | number | null;
      destinationWalletId?: string | null;
      autoMint?: boolean;
      enabled?: boolean;
    }>(req);

    if (!body.walletAddress) {
      return NextResponse.json({ error: 'walletAddress is required' }, { status: 400 });
    }

    const rule = await upsertCopyMintRule(authResult.userId, {
      walletAddress: body.walletAddress,
      maxPrice: body.maxPrice,
      quantity: body.quantity,
      minMintCount: body.minMintCount,
      destinationWalletId: body.destinationWalletId,
      autoMint: body.autoMint,
      enabled: body.enabled,
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to process copy-mint rule');
  }
}
