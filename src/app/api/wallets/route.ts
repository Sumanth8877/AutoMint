import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { enforceRateLimit, RATE_LIMITS } from '@/lib/api/rate-limit';
import { getUserWallets, importWallet, removeWallet } from '@/lib/services/wallet.service';
import type { ImportWalletType } from '@/lib/wallets/private-key';

// Disable cache — mutations need fresh data immediately
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/wallets
export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const userWallets = await getUserWallets(authResult.userId);
    return NextResponse.json({ wallets: userWallets });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to fetch wallets') }, { status: 500 });
  }
}

// POST /api/wallets
export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const limited = await enforceRateLimit(`wallets:import:${authResult.userId}`, RATE_LIMITS.sensitive);
    if (limited) return limited;

    const body = await parseJsonBody<{ walletType?: ImportWalletType; privateKey?: string; nickname?: string | null }>(req);
    const { walletType, privateKey, nickname } = body;

    if (!walletType || walletType !== 'EVM' && walletType !== 'SOLANA' && walletType !== 'BITCOIN') {
      return NextResponse.json({ error: 'Wallet type is required (EVM, SOLANA, or BITCOIN)' }, { status: 400 });
    }

    if (!privateKey) {
      return NextResponse.json({ error: 'Private key is required' }, { status: 400 });
    }

    const wallet = await importWallet(authResult.userId, { walletType, privateKey, nickname });

    return NextResponse.json({ wallet }, { status: 201 });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to import wallet');
    const status = message === 'Wallet already added'
      ? 409
      : message === 'Invalid JSON request body' || message.includes('Invalid') || message.includes('required')
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

// DELETE /api/wallets
export async function DELETE(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ id?: string }>(req);
    const { id } = body;

    if (!id) return NextResponse.json({ error: 'Wallet ID is required' }, { status: 400 });

    await removeWallet(id, authResult.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to delete wallet');
    const status = message.includes('not found') ? 404 : message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
