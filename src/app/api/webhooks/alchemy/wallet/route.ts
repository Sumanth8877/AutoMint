import { NextResponse } from 'next/server';
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
    console.error('Alchemy wallet webhook error:', error);
    const message = error instanceof Error ? error.message : 'Alchemy wallet webhook failed';
    const status = message.toLowerCase().includes('signature') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
