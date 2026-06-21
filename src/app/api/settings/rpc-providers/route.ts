import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody } from '@/lib/api/errors';
import {
  getRpcProviderSettings,
  updateRpcProviderSettings,
} from '@/lib/services/rpc-provider-settings.service';
import { getRpcRoutingSnapshot } from '@/lib/services/rpc-manager.service';

async function getPayload(userId: string) {
  const [settings, routing] = await Promise.all([
    getRpcProviderSettings(userId),
    getRpcRoutingSnapshot(userId),
  ]);

  return {
    settings,
    routing,
  };
}

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    return NextResponse.json(await getPayload(authResult.userId));
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to load RPC provider settings') }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<Record<string, unknown>>(req);
    await updateRpcProviderSettings(authResult.userId, body);

    return NextResponse.json(await getPayload(authResult.userId));
  } catch (error) {
    const message = getErrorMessage(error, 'Failed to update RPC provider settings');
    const status = message.includes('must be') || message === 'Invalid JSON request body' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
