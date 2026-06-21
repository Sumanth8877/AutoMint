import { NextResponse } from 'next/server';
import {
  executeScheduledMint,
  executeScheduledRiskRecheck,
  verifyQStashSignature,
  type ScheduledMintPayload,
} from '@/lib/services/qstash.service';
import { captureException } from '@/lib/observability/sentry';

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

    const result = payload.type === 'risk_check'
      ? await executeScheduledRiskRecheck(payload.taskId)
      : await executeScheduledMint(payload.taskId);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('QStash webhook error:', error);
    const message = error instanceof Error ? error.message : 'QStash webhook failed';
    const status = message.toLowerCase().includes('signature') || message.includes('Signing') ? 401 : 500;
    if (status >= 500) {
      await captureException(error, {
        area: 'qstash',
        context: { route: '/api/webhooks/qstash' },
        fingerprint: ['qstash', 'webhook'],
      });
    }
    return NextResponse.json({ error: message }, { status });
  }
}
