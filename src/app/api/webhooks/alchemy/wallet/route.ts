import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  handleAlchemyWalletWebhook,
  verifyAlchemyWebhookSignature,
} from '@/lib/services/wallet-tracker.service';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    verifyAlchemyWebhookSignature(request.headers, rawBody);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const result = await handleAlchemyWalletWebhook(payload as Parameters<typeof handleAlchemyWalletWebhook>[0]);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    let status: number;
    let publicError: string;
    if (message.includes('signature')) {
      status = 401;
      publicError = 'Invalid webhook signature';
    } else if (message.includes('not configured')) {
      // H1: don't leak the fact that the signing key env-var is missing.
      status = 503;
      publicError = 'Webhook signature verification unavailable';
    } else {
      status = 500;
      publicError = 'Alchemy wallet webhook failed';
    }
    if (status >= 500) {
      // M-03 fix: unexpected errors were previously swallowed with no
      // logging at all. Log them so production failures in wallet-webhook
      // processing are actually visible.
      logger.error('[alchemy/wallet] webhook failed', {
        status,
        message,
        stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined,
      });
    } else {
      logger.warn('[alchemy/wallet] webhook rejected', { status, message });
    }
    return NextResponse.json({ error: publicError }, { status });
  }
}
