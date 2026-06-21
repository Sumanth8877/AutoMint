import path from 'node:path';
import { rm } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';

function workspacePath(...segments: string[]) {
  const root = process.cwd();
  const target = path.join(/*turbopackIgnore: true*/ root, ...segments);

  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Refusing to delete outside the workspace');
  }

  return target;
}

export async function POST() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const targets = [
    workspacePath('src', 'app', '(authenticated)', 'settings', 'runtime-check'),
    workspacePath('src', 'app', 'api', 'settings', 'runtime-check'),
  ];

  try {
    await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
    return NextResponse.json({ message: 'Runtime check source files deleted.' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete runtime check source files.' },
      { status: 500 },
    );
  }
}
