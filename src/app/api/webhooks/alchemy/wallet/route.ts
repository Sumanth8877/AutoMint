import { NextResponse } from 'next/server';
import {
  handleAlchemyWalletWebhook,
  verifyAlchemyWebhookSignature,
} from '@/lib/services/wallet-tracker.service';
import { captureException } from '@/lib/observability/sentry';

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
    captureException(error, { area: 'webhooks', context: { route: 'webhooks/alchemy' }, fingerprint: ['webhooks', 'alchemy-wallet'] });
    const message = error instanceof Error ? error.message : 'Alchemy wallet webhook failed';
    const status = message.toLowerCase().includes('signature') ? 401 : 500;
    if (status >= 500) {
      await captureException(error, {
        area: 'wallet-tracker',
        context: { route: '/api/webhooks/alchemy/wallet', provider: 'alchemy' },
        fingerprint: ['wallet-tracker', 'webhook'],
      });
    }
    return NextResponse.json({ error: message }, { status });
  }
}
