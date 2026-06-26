import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getErrorMessage, parseJsonBody, handleRouteError } from '@/lib/api/errors';
import {
  getExecutionSettingsPayload,
  updateExecutionSettings,
} from '@/lib/services/execution-settings.service';

export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    return NextResponse.json(await getExecutionSettingsPayload(authResult.userId));
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error, 'Failed to load execution settings') }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<Record<string, unknown>>(req);
    await updateExecutionSettings(authResult.userId, body);

    return NextResponse.json(await getExecutionSettingsPayload(authResult.userId));
  } catch (error) {
    return handleRouteError(error, 'Failed to update execution settings');
  }
}
