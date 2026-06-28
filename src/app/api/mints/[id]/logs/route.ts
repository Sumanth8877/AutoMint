import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getTaskLogs } from '@/lib/services/task-log.service';
import { getMintTaskById } from '@/lib/services/mint.service';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const { id } = await params;
    const task = await getMintTaskById(id, authResult.userId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    const logs = await getTaskLogs(id);
    return NextResponse.json({ logs: logs.reverse() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch logs' },
      { status: 500 },
    );
  }
}
