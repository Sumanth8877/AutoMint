import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getCollectionMetadata } from '@/lib/blockchain/collections';

export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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