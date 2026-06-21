import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ ok: true, probe: 'infrastructure-qstash' });
}

export async function GET() {
  return NextResponse.json({ ok: true, probe: 'infrastructure-qstash' });
}
