import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/require-auth';
import { estimateGas } from '@/lib/blockchain/gas';

export async function GET(req: Request) {
  const authResult = await requireApiSession();
  if ('error' in authResult) return authResult.error;

  const { searchParams } = new URL(req.url);
  const chain = searchParams.get('chain');

  if (!chain) {
    return NextResponse.json({ error: 'Chain is required' }, { status: 400 });
  }

  try {
    const gas = await estimateGas(chain);
    return NextResponse.json({ gas });
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to estimate gas' }, { status: 500 });
  }
}
