import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/auth/require-auth';
import { getSetting, setSetting, deleteSetting } from '@/lib/services/integration-settings.service';

/**
 * GET /api/settings/ai-keys
 * Returns masked status of AI provider keys (never reveals the full key).
 */
export async function GET() {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  const [gemini, nara] = await Promise.all([
    getSetting('GEMINI_API_KEY'),
    getSetting('NARA_API_KEY'),
  ]);

  return NextResponse.json({
    gemini: gemini
      ? { configured: true, maskedKey: maskKey(gemini.value), updatedAt: gemini.updatedAt }
      : { configured: false, maskedKey: null, updatedAt: null },
    nara: nara
      ? { configured: true, maskedKey: maskKey(nara.value), updatedAt: nara.updatedAt }
      : { configured: false, maskedKey: null, updatedAt: null },
    // Also report if env vars are set (env vars are fallback)
    geminiEnvConfigured: !!process.env.GEMINI_API_KEY,
    naraEnvConfigured: !!process.env.NARA_API_KEY,
  });
}

/**
 * POST /api/settings/ai-keys
 * Save or delete an AI provider key.
 * Body: { provider: 'gemini' | 'nara', key: string | null }
 * Passing key=null or key='' deletes the stored key (falls back to env var).
 */
export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ('error' in authResult) return authResult.error;

  let body: { provider?: string; key?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { provider, key } = body;
  if (!provider || !['gemini', 'nara'].includes(provider)) {
    return NextResponse.json({ error: 'Invalid provider. Use "gemini" or "nara".' }, { status: 400 });
  }

  const settingKey = provider === 'gemini' ? 'GEMINI_API_KEY' as const : 'NARA_API_KEY' as const;

  // Delete if key is null/empty
  if (!key || key.trim() === '') {
    await deleteSetting(settingKey);
    return NextResponse.json({ success: true, action: 'deleted', provider });
  }

  // Validate key format (basic sanity check)
  const trimmedKey = key.trim();
  if (trimmedKey.length < 10) {
    return NextResponse.json({ error: 'API key seems too short. Please check and try again.' }, { status: 400 });
  }

  await setSetting(settingKey, trimmedKey);

  return NextResponse.json({
    success: true,
    action: 'saved',
    provider,
    maskedKey: maskKey(trimmedKey),
  });
}

/** Mask a key: show first 4 and last 4 chars. */
function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(key.length - 8, 20))}${key.slice(-4)}`;
}
