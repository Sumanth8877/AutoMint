import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { parseJsonBody, handleRouteError } from '@/lib/api/errors';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  deleteApiKey,
  renameApiKey,
  type CreateApiKeyInput,
} from '@/lib/services/api-key.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ─── GET /api/api-keys — list all keys for the authenticated user ───
export async function GET() {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const keys = await listApiKeys(authResult.userId);
    return NextResponse.json({ keys });
  } catch (error) {
    return handleRouteError(error, 'Failed to list API keys');
  }
}

// ─── POST /api/api-keys — create a new API key ─────────────────────
export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    // Rate-limit key creation
    const limited = await enforceRateLimit(
      `api-keys:create:${authResult.userId}`,
      { limit: 10, windowSeconds: 3600 },
    );
    if (limited) return limited;

    const body = await parseJsonBody<CreateApiKeyInput>(req);

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Key name is required' }, { status: 400 });
    }

    if (body.name.trim().length > 64) {
      return NextResponse.json({ error: 'Key name must be 64 characters or less' }, { status: 400 });
    }

    const result = await createApiKey(authResult.userId, body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to create API key');
  }
}

// ─── PATCH /api/api-keys — revoke or rename a key ──────────────────
export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ id?: string; action?: 'revoke' | 'rename'; name?: string }>(req);

    if (!body.id) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
    }

    if (body.action === 'revoke') {
      await revokeApiKey(body.id, authResult.userId);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'rename') {
      if (!body.name?.trim()) {
        return NextResponse.json({ error: 'New name is required' }, { status: 400 });
      }
      await renameApiKey(body.id, authResult.userId, body.name);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid action. Use "revoke" or "rename".' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, 'Failed to update API key');
  }
}

// ─── DELETE /api/api-keys — permanently delete a key ────────────────
export async function DELETE(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ id?: string }>(req);

    if (!body.id) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
    }

    await deleteApiKey(body.id, authResult.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Failed to delete API key');
  }
}
