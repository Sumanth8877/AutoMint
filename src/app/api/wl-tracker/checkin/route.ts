import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { handleRouteError, parseJsonBody } from '@/lib/api/errors';
import {
  disableDailyCheckin,
  enableDailyCheckin,
  listAllCheckinProjects,
  listPendingCheckins,
  markCheckinDone,
} from '@/lib/services/wl-checkin.service';

// ─── GET /api/wl-tracker/checkin ─────────────────────────────────────────
// Two query modes:
//   ?mode=pending&tz=Asia/Calcutta   → projects with a check-in still due
//                                       today in the user's timezone
//   ?mode=all                        → all projects with daily check-in
//                                       enabled (default)
export async function GET(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const url = new URL(req.url);
    const mode = url.searchParams.get('mode') ?? 'all';
    const tz = url.searchParams.get('tz') ?? 'UTC';

    if (mode === 'pending') {
      const pending = await listPendingCheckins(authResult.userId, tz);
      return NextResponse.json({ pending });
    }
    const all = await listAllCheckinProjects(authResult.userId);
    return NextResponse.json({ projects: all });
  } catch (error) {
    return handleRouteError(error, 'Failed to list check-ins');
  }
}

// ─── POST /api/wl-tracker/checkin ────────────────────────────────────────
// Body: { projectId, notes?, source? } — logs one completed check-in.
export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ projectId?: string; notes?: string; source?: 'web' | 'telegram' | 'ai' }>(req);
    if (!body.projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    const result = await markCheckinDone(authResult.userId, body.projectId, {
      notes: body.notes ?? null,
      source: body.source ?? 'web',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error, 'Failed to record check-in');
  }
}

// ─── PATCH /api/wl-tracker/checkin ───────────────────────────────────────
// Body: { projectId, enabled: boolean, url?, timeHint? }
export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{
      projectId?: string; enabled?: boolean;
      url?: string | null; timeHint?: string | null;
    }>(req);

    if (!body.projectId || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'projectId and enabled are required' }, { status: 400 });
    }

    if (body.enabled) {
      await enableDailyCheckin(authResult.userId, body.projectId, {
        url: body.url ?? null,
        timeHint: body.timeHint ?? null,
      });
    } else {
      await disableDailyCheckin(authResult.userId, body.projectId);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Failed to update check-in settings');
  }
}
