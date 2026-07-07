import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { handleRouteError, parseJsonBody, ValidationError } from '@/lib/api/errors';
import {
  addTrackedProject,
  listTrackedProjects,
  type AddTrackedProjectInput,
} from '@/lib/services/wl-tracker.service';

// ─── GET /api/wl-tracker ─────────────────────────────────────────────────
// Returns the current user's tracked WL projects, newest first. `includeArchived=true`
// includes projects the user has archived.
export async function GET(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const url = new URL(req.url);
    const includeArchived = url.searchParams.get('includeArchived') === 'true';

    const projects = await listTrackedProjects(authResult.userId, { includeArchived });
    return NextResponse.json({ projects });
  } catch (error) {
    return handleRouteError(error, 'Failed to list tracked projects');
  }
}

// ─── POST /api/wl-tracker ────────────────────────────────────────────────
// Body: { handle, walletUsed?, formType?, formUrl?, notes?, expectedMintDate?, wlAnnouncementHint?, pollFrequencyMinutes? }
// Resolves the Twitter profile, baselines the cursor, and persists.
export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<Partial<AddTrackedProjectInput> & { handle?: string }>(req);
    if (!body.handle || typeof body.handle !== 'string') {
      throw new ValidationError('handle is required');
    }

    const project = await addTrackedProject(authResult.userId, {
      handle: body.handle,
      walletUsed: body.walletUsed ?? null,
      formType: body.formType,
      formUrl: body.formUrl ?? null,
      notes: body.notes ?? null,
      expectedMintDate: body.expectedMintDate ? new Date(body.expectedMintDate) : null,
      wlAnnouncementHint: body.wlAnnouncementHint ? new Date(body.wlAnnouncementHint) : null,
      pollFrequencyMinutes: body.pollFrequencyMinutes,
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, 'Failed to add tracked project');
  }
}
