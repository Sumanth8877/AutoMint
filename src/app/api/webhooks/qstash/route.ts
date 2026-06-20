import { NextResponse } from 'next/server';
import {
  executeScheduledMint,
  verifyQStashSignature,
  type ScheduledMintPayload,
} from '@/lib/services/qstash.service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    verifyQStashSignature(request.headers, rawBody);

    let payload: ScheduledMintPayload;
    try {
      payload = JSON.parse(rawBody) as ScheduledMintPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    if (!payload.taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    const result = await executeScheduledMint(payload.taskId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('QStash webhook error:', error);
    const message = error instanceof Error ? error.message : 'QStash webhook failed';
    const status = message.toLowerCase().includes('signature') || message.includes('Signing') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
