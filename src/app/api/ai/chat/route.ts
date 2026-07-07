import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { parseJsonBody, getErrorMessage } from '@/lib/api/errors';
import { interpretWebMessage, type WebChatMessage } from '@/lib/services/ai-interpreter.service';
import { parseMintShortcut, executeMintShortcut } from '@/lib/services/mint-shortcut.service';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  let messages: WebChatMessage[] = [];
  try {
    const body = await parseJsonBody<{ messages?: WebChatMessage[] }>(req);
    messages = Array.isArray(body.messages) ? body.messages : [];
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || !lastMsg.content.trim()) {
    return NextResponse.json({ error: 'At least one user message is required' }, { status: 400 });
  }

  // ── Fast path: direct mint shortcut — zero AI overhead ───────────────────
  // Patterns: <url>, <url> <qty>, /mint <url>, /mint <url> <qty>
  const shortcut = parseMintShortcut(lastMsg.content);
  if (shortcut) {
    try {
      const reply = await executeMintShortcut(shortcut, authResult.userId);
      return NextResponse.json({ reply, shortcut: true });
    } catch (err) {
      return NextResponse.json(
        { error: getErrorMessage(err, 'Mint failed') },
        { status: 500 },
      );
    }
  }

  // ── Slow path: natural language → AI interpreter ─────────────────────────
  try {
    const reply = await interpretWebMessage(messages, authResult.userId);
    return NextResponse.json({ reply });
  } catch (err) {
    return NextResponse.json(
      { error: getErrorMessage(err, 'AI request failed') },
      { status: 500 },
    );
  }
}
