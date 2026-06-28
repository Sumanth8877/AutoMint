import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  executeScheduledMint,
  executeScheduledRiskRecheck,
  executeReceiptRecheck,
  executeRecoveryCheck,
  verifyQStashSignature,
  type ScheduledMintPayload,
} from '@/lib/services/qstash.service';
import { captureException } from '@/lib/observability/sentry';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    await verifyQStashSignature(request.headers, rawBody);

    let payload: ScheduledMintPayload;
    try {
      payload = JSON.parse(rawBody) as ScheduledMintPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    if (!payload.taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }

    let result;
    if (payload.type === 'risk_check') {
      result = await executeScheduledRiskRecheck(payload.taskId);
    } else if (payload.type === 'receipt_check') {
      // C-04: poll chain for known txHash — never calls sendTransaction
      result = await executeReceiptRecheck(payload.taskId);
    } else if (payload.type === 'recovery') {
      result = await executeRecoveryCheck();
    } else {
      result = await executeScheduledMint(payload.taskId);
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    let status: number;
    let publicError: string;
    if (message.includes('signature') || message.includes('signing')) {
      status = 401;
      publicError = 'Invalid webhook signature';
    } else if (message.includes('not configured')) {
      // H1: don't leak the fact that QStash signing keys aren't configured.
      status = 503;
      publicError = 'Webhook signature verification unavailable';
    } else {
      status = 500;
      publicError = 'QStash webhook failed';
    }
    if (status >= 500) {
      await captureException(error, {
        area: 'qstash',
        context: { route: '/api/webhooks/qstash' },
        fingerprint: ['qstash', 'webhook'],
      });
    } else {
      logger.warn('[qstash] webhook rejected', { status, message });
    }
    return NextResponse.json({ error: publicError }, { status });
  }
}
