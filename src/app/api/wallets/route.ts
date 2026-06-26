import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { getUserWallets, importWallet, removeWallet } from '@/lib/services/wallet.service';
import type { ImportWalletType } from '@/lib/wallets/private-key';

// Disable cache — mutations need fresh data immediately
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Hex private key format: optional 0x prefix, then exactly 64 hex characters.
// Validated here before the key ever reaches importWallet or the DB layer.
const EVM_PRIVATE_KEY_RE = /^(?:0x)?[a-fA-F0-9]{64}$/;

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


    const body = await parseJsonBody<{ walletType?: ImportWalletType; privateKey?: string; nickname?: string | null }>(req);
    const { walletType, privateKey, nickname } = body;

    if (!walletType || walletType !== 'EVM' && walletType !== 'SOLANA' && walletType !== 'BITCOIN') {
      return NextResponse.json({ error: 'Wallet type is required (EVM, SOLANA, or BITCOIN)' }, { status: 400 });
    }

    if (!privateKey) {
      return NextResponse.json({ error: 'Private key is required' }, { status: 400 });
    }

    // Validate EVM private key format before hitting importWallet
    if (walletType === 'EVM' && !EVM_PRIVATE_KEY_RE.test(privateKey)) {
      return NextResponse.json({ error: 'Invalid EVM private key format (expected 32-byte hex)' }, { status: 400 });
    }

    const wallet = await importWallet(authResult.userId, { walletType, privateKey, nickname });

    return NextResponse.json({ wallet }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to import wallet');
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
    return handleRouteError(error, 'Failed to delete wallet');
  }
}
