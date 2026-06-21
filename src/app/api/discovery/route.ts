import { NextResponse } from 'next/server';
import { parseJsonBody } from '@/lib/api/errors';
import { requireApiUser } from '@/lib/auth/require-auth';
import { discoverCollection } from '@/lib/services/discovery.service';
import { captureException } from '@/lib/observability/sentry';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Discovery request failed';
}

export async function POST(req: Request) {
  try {
    const authResult = await requireApiUser();
    if ('error' in authResult) return authResult.error;

    const body = await parseJsonBody<{ url?: string }>(req);
    const url = body.url?.trim();

    if (!url) {
      return NextResponse.json({ error: 'OpenSea URL is required' }, { status: 400 });
    }

    const result = await discoverCollection(url);
    return NextResponse.json(result);
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message === 'Invalid JSON request body'
      ? 400
      : message.includes('OpenSea') || message.includes('valid')
        ? 400
        : 500;

    if (status >= 500) {
      await captureException(error, {
        area: 'discovery',
        context: { route: '/api/discovery' },
        fingerprint: ['discovery', 'route'],
      });
    }

    return NextResponse.json({ error: message }, { status });
  }
}
