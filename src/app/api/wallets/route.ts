import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import { createWallet, getUserWallets, removeWallet } from '@/lib/services/wallet.service';

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

    const body = await parseJsonBody<{ address?: string; nickname?: string; chain?: string; walletTypeOverride?: string | null }>(req);
    const { address, nickname, chain, walletTypeOverride } = body;

    if (!address || !chain) {
      return NextResponse.json({ error: 'Address and chain are required' }, { status: 400 });
    }

    const wallet = await createWallet(authResult.userId, { address, nickname, chain, walletTypeOverride });

    return NextResponse.json({ wallet }, { status: 201 });
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to create wallet');
    const status = message === 'Wallet already added' ? 409 : message === 'Invalid JSON request body' ? 400 : message.includes('Invalid') || message.includes('Unsupported') ? 400 : 500;
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
