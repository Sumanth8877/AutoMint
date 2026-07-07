import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { handleRouteError, parseJsonBody } from '@/lib/api/errors';
import {
  listTweetsForUser,
  listTweetsForProject,
  markTweetRead,
  markTweetAsWinner,
} from '@/lib/services/wl-tracker.service';

// ─── GET /api/wl-tracker/tweets ──────────────────────────────────────────
// Feed view. Query params:
//   projectId=uuid    → filter to one project
//   unreadOnly=true   → only unread notifications
//   limit=N           → cap results (default 50, max 200)
export async function GET(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId');
    const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
    const limit = Number(url.searchParams.get('limit')) || 50;

    const tweets = projectId
      ? await listTweetsForProject(authResult.userId, projectId, limit)
      : await listTweetsForUser(authResult.userId, { limit, unreadOnly });

    return NextResponse.json({ tweets });
  } catch (error) {
    return handleRouteError(error, 'Failed to list tweets');
  }
}

// ─── PATCH /api/wl-tracker/tweets ────────────────────────────────────────
// Body: { tweetId: uuid, action: 'read' | 'winner' }
// Two lightweight mutations kept in a single endpoint so the client doesn't
// need to juggle multiple URLs for a hot path.
export async function PATCH(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ tweetId?: string; action?: 'read' | 'winner' }>(req);
    if (!body.tweetId || !body.action) {
      return NextResponse.json({ error: 'tweetId and action are required' }, { status: 400 });
    }

    if (body.action === 'read') {
      await markTweetRead(authResult.userId, body.tweetId);
    } else if (body.action === 'winner') {
      await markTweetAsWinner(authResult.userId, body.tweetId);
    } else {
      return NextResponse.json({ error: 'action must be "read" or "winner"' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'Failed to update tweet');
  }
}
