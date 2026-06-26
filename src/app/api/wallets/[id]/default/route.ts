import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, handleRouteError } from '@/lib/api/errors';
import { setDefaultWallet } from '@/lib/services/wallet.service';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(_req: Request, context: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await context.params;
    const wallet = await setDefaultWallet(id, authResult.userId);

    return NextResponse.json({ wallet });
  } catch (error) {
    return handleRouteError(error, 'Failed to update default wallet');
  }
}
