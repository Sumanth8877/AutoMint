import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { removeWallet, updateWallet } from '@/lib/services/wallet.service';

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateWalletBody = {
  nickname?: string | null;
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await context.params;
    const body = await parseJsonBody<UpdateWalletBody>(req);
    const wallet = await updateWallet(id, authResult.userId, {
      nickname: body.nickname ?? null,
    });

    return NextResponse.json({ wallet });
  } catch (error) {
    return handleRouteError(error, 'Failed to process wallet request');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await context.params;
    await removeWallet(id, authResult.userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Failed to process wallet request');
  }
}
