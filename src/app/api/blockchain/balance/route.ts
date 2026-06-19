import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getWalletBalance } from '@/lib/blockchain/wallet';

export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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