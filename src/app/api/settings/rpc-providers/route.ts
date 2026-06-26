import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import {
  getRpcProviderSettings,
  updateRpcProviderSettings,
} from '@/lib/services/rpc-provider-settings.service';
import { refreshRpcProviderLatency } from '@/lib/services/rpc-manager.service';

async function getPayload(userId: string) {
  const [settings, routing] = await Promise.all([
    getRpcProviderSettings(userId),
    refreshRpcProviderLatency(userId),
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
    return handleRouteError(error, 'Failed to update RPC provider settings');
  }
}
