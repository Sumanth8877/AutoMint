import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { estimateGas } from '@/lib/blockchain/gas';

export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const chain = searchParams.get('chain');

  if (!chain) {
    return NextResponse.json({ error: 'Chain is required' }, { status: 400 });
  }

  try {
    const gas = await estimateGas(chain);
    return NextResponse.json({ gas });
  } catch (error) {
    console.error('Error estimating gas:', error);
    return NextResponse.json({ error: 'Failed to estimate gas' }, { status: 500 });
  }
}