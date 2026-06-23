import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { getCopyMintRules, upsertCopyMintRule } from '@/lib/services/copy-mint.service';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Copy mint rule request failed';
}

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const rateLimited = await enforceRateLimit(`copy-mint:rules:${authResult.userId}`, RATE_LIMITS.sensitive);
    if (rateLimited) return rateLimited;

    const rules = await getCopyMintRules(authResult.userId);
    return NextResponse.json({ rules });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
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
      riskThreshold?: string | number | null;
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
      riskThreshold: body.riskThreshold,
      destinationWalletId: body.destinationWalletId,
      autoMint: body.autoMint,
      enabled: body.enabled,
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === 'Invalid JSON request body' || message.includes('Invalid') || message.includes('required') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
