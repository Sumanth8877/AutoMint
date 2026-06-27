import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { deleteCopyMintRule, updateCopyMintRule } from '@/lib/services/copy-mint.service';


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
    return handleRouteError(error, 'Failed to update copy-mint rule');
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
    return handleRouteError(error, 'Failed to update copy-mint rule');
  }
}
