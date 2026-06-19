import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth/require-auth';

export async function GET(req: Request) {
  const authResult = await requireApiSession();
  if ('error' in authResult) return authResult.error;

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
