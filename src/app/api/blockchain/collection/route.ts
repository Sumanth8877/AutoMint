import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/require-auth';
import { getCollectionMetadata } from '@/lib/blockchain/collections';

export async function GET(req: Request) {
  const authResult = await requireApiSession();
  if ('error' in authResult) return authResult.error;

  const { searchParams } = new URL(req.url);
  const contractAddress = searchParams.get('contractAddress');
  const chain = searchParams.get('chain');

  if (!contractAddress || !chain) {
    return NextResponse.json({ error: 'Contract address and chain are required' }, { status: 400 });
  }

  try {
    const metadata = await getCollectionMetadata(contractAddress, chain);
    return NextResponse.json({ metadata });
  } catch (error) {
    console.error('Error fetching collection metadata:', error);
    return NextResponse.json({ error: 'Failed to fetch collection metadata' }, { status: 500 });
  }
}
