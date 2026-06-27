import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage } from '@/lib/api/errors';
import { deleteAccount } from '@/lib/services/account-deletion.service';

export async function DELETE() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    // Account deletion requires a real Clerk session — refuse the destructive
    // action when the caller authenticated via the env-var API key (clerkId
    // is null in that flow).
    if (!authResult.clerkId) {
      return NextResponse.json(
        { error: 'Account deletion requires an interactive session.' },
        { status: 403 },
      );
    }

    await deleteAccount({
      userId: authResult.userId,
      clerkId: authResult.clerkId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to delete account') }, { status: 500 });
  }
}
