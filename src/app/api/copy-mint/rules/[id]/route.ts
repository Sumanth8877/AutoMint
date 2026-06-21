import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { deleteCopyMintRule, updateCopyMintRule } from '@/lib/services/copy-mint.service';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Copy mint rule request failed';
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await context.params;
    const body = await parseJsonBody<{
      maxPrice?: string | number | null;
      quantity?: string | number | null;
      riskThreshold?: string | number | null;
      destinationWalletId?: string | null;
      autoMint?: boolean;
      enabled?: boolean;
    }>(req);

    const rule = await updateCopyMintRule(authResult.userId, id, body);
    return NextResponse.json({ rule });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes('not found') ? 404 : message.includes('Invalid') ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await context.params;
    await deleteCopyMintRule(authResult.userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
