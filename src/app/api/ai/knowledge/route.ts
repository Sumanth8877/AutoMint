import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { invalidateGuideCache, getKnowledgeBase } from '@/lib/services/knowledge-base.service';

export const dynamic = 'force-dynamic';

/** GET — returns current guide length for health checks */
export async function GET(_req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const guide = getKnowledgeBase();
  return NextResponse.json({
    loaded: guide.length > 0,
    chars: guide.length,
    lines: guide.split('\n').length,
  });
}

/** POST — invalidates the cache so the next AI call re-reads the file */
export async function POST(_req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  invalidateGuideCache();
  const guide = getKnowledgeBase(); // trigger immediate reload
  return NextResponse.json({
    ok: true,
    message: 'Knowledge base reloaded',
    chars: guide.length,
    lines: guide.split('\n').length,
  });
}
