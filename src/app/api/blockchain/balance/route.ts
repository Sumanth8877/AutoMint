import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getWalletBalance } from '@/lib/blockchain/wallet';
import { notifyWalletBalanceIfLow } from '@/lib/services/telegram.service';
import { captureException } from '@/lib/observability/sentry';

export async function GET(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');
  const chain = searchParams.get('chain');

  if (!address || !chain) {
    return NextResponse.json({ error: 'Address and chain are required' }, { status: 400 });
  }

  try {
    const balance = await getWalletBalance(address, chain);
    await notifyWalletBalanceIfLow({
      userId: authResult.userId,
      address,
      chain,
      balance: balance.balance,
      symbol: balance.symbol,
    });
    return NextResponse.json({ balance });
  } catch (error) {
    captureException(error, { area: 'api', context: { route: 'blockchain/balance' }, fingerprint: ['api', 'blockchain-balance'] });
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
}
