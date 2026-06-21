import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { removeWallet, updateWallet } from '@/lib/services/wallet.service';

type RouteContext = {
  params: Promise<{ id: string }>;
};

type UpdateWalletBody = {
  nickname?: string | null;
  chain?: string;
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await context.params;
    const body = await parseJsonBody<UpdateWalletBody>(req);
    const wallet = await updateWallet(id, authResult.userId, {
      nickname: body.nickname ?? null,
      chain: body.chain,
    });

    return NextResponse.json({ wallet });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to update wallet');
    const status = message.includes('not found')
      ? 404
      : message === 'Invalid JSON request body' || message.includes('Unsupported')
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
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
    const message = getErrorMessage(error, 'Failed to delete wallet');
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
