import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { parseJsonBody, getErrorMessage } from '@/lib/api/errors';
import { interpretTelegramMessage } from '@/lib/services/ai-interpreter.service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  let message = '';
  try {
    const body = await parseJsonBody<{ message?: string }>(req);
    message = body.message?.trim() ?? '';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!message) {
    return NextResponse.json({ error: 'Message is required' }, { status: 400 });
  }

  try {
    const reply = await interpretTelegramMessage(message, authResult.userId);
    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, 'AI request failed') },
      { status: 500 },
    );
  }
}
