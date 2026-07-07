import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { handleRouteError, parseJsonBody } from '@/lib/api/errors';
import {
  archiveTrackedProject,
  deleteTrackedProject,
  getTrackedProject,
  updateTrackedProject,
} from '@/lib/services/wl-tracker.service';

// Next.js 15+ route handler signature: params is a Promise.
type RouteContext = { params: Promise<{ id: string }> };

// ─── GET /api/wl-tracker/[id] ────────────────────────────────────────────
export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await params;
    const project = await getTrackedProject(authResult.userId, id);
    return NextResponse.json({ project });
  } catch (error) {
    return handleRouteError(error, 'Failed to load tracked project');
  }
}

// ─── PATCH /api/wl-tracker/[id] ──────────────────────────────────────────
// Partial update — only whitelisted user-editable fields.
export async function PATCH(req: Request, { params }: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await params;
    const body = await parseJsonBody<Record<string, unknown>>(req);

    const updates: Parameters<typeof updateTrackedProject>[2] = {};
    if ('walletUsed' in body) updates.walletUsed = (body.walletUsed as string | null) ?? null;
    if ('formType' in body) updates.formType = body.formType as typeof updates.formType;
    if ('formUrl' in body) updates.formUrl = (body.formUrl as string | null) ?? null;
    if ('notes' in body) updates.notes = (body.notes as string | null) ?? null;
    if ('expectedMintDate' in body) {
      updates.expectedMintDate = body.expectedMintDate ? new Date(body.expectedMintDate as string) : null;
    }
    if ('wlAnnouncementHint' in body) {
      updates.wlAnnouncementHint = body.wlAnnouncementHint ? new Date(body.wlAnnouncementHint as string) : null;
    }
    if ('pollFrequencyMinutes' in body && typeof body.pollFrequencyMinutes === 'number') {
      // Clamp to 5..240 minutes to protect the provider budget.
      updates.pollFrequencyMinutes = Math.max(5, Math.min(240, body.pollFrequencyMinutes));
    }
    if ('isActive' in body && typeof body.isActive === 'boolean') {
      updates.isActive = body.isActive;
    }

    const project = await updateTrackedProject(authResult.userId, id, updates);
    return NextResponse.json({ project });
  } catch (error) {
    return handleRouteError(error, 'Failed to update tracked project');
  }
}

// ─── DELETE /api/wl-tracker/[id] ─────────────────────────────────────────
// `?mode=archive` (default) sets archived_at; `?mode=hard` permanently deletes
// the row and cascades to any tracked tweets.
export async function DELETE(req: Request, { params }: RouteContext) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await params;
    const url = new URL(req.url);
    const mode = url.searchParams.get('mode');

    if (mode === 'hard') {
      await deleteTrackedProject(authResult.userId, id);
    } else {
      await archiveTrackedProject(authResult.userId, id);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Failed to remove tracked project');
  }
}
