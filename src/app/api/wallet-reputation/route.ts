import { NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { walletReputation } from '@/drizzle/schema';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getDb } from '@/lib/db';
import { getUserWatchedWallets } from '@/lib/services/wallet-tracker.service';

export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const watched = await getUserWatchedWallets(authResult.userId);
  const addresses = Array.from(new Set(watched.map((wallet) => wallet.walletAddress)));

  if (addresses.length === 0) {
    return NextResponse.json({ reputations: [] });
  }

  const reputations = await getDb()
    .select()
    .from(walletReputation)
    .where(inArray(walletReputation.walletAddress, addresses));

  return NextResponse.json({ reputations });
}
