import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/require-auth';
import { getWalletBalance } from '@/lib/blockchain/wallet';

export async function GET(req: Request) {
  const authResult = await requireApiSession();
  if ('error' in authResult) return authResult.error;

  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');
  const chain = searchParams.get('chain');

  if (!address || !chain) {
    return NextResponse.json({ error: 'Address and chain are required' }, { status: 400 });
  }

  try {
    const balance = await getWalletBalance(address, chain);
    return NextResponse.json({ balance });
  } catch (error) {
    console.error('Error fetching balance:', error);
    return NextResponse.json({ error: 'Failed to fetch balance' }, { status: 500 });
  }
}
