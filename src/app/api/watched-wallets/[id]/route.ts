import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { deleteWatchedWallet, updateWatchedWallet } from '@/lib/services/wallet-tracker.service';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Watched wallet request failed';
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await context.params;
    const body = await parseJsonBody<{ walletName?: string | null; active?: boolean }>(req);
    const wallet = await updateWatchedWallet(authResult.userId, id, body);
    return NextResponse.json({ wallet });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await context.params;
    await deleteWatchedWallet(authResult.userId, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
