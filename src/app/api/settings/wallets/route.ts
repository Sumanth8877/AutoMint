import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage } from '@/lib/api/errors';
import { getUserWallets } from '@/lib/services/wallet.service';

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const userWallets = await getUserWallets(authResult.userId);
    return NextResponse.json({ wallets: userWallets });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to fetch wallets') }, { status: 500 });
  }
}
