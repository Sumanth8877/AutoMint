import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function GET(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const contractAddress = searchParams.get('contractAddress');
  const chain = searchParams.get('chain');

  if (!contractAddress || !chain) {
    return NextResponse.json({ error: 'Contract address and chain are required' }, { status: 400 });
  }

  // Placeholder: mint status detection requires contract ABI reads
  // which vary by collection. Returning unknown for now.
  return NextResponse.json({
    status: 'unknown',
    message: 'Mint status detection coming soon',
  });
}