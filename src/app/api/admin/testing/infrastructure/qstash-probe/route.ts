import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';

export async function POST() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  return NextResponse.json({ ok: true, probe: 'infrastructure-qstash' });
}

export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  return NextResponse.json({ ok: true, probe: 'infrastructure-qstash' });
}
