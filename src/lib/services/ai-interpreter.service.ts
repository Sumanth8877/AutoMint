import 'server-only';

import { addBreadcrumb, captureException } from '@/lib/observability/sentry';
import { logger } from '@/lib/logger';

// ── Config ───────────────────────────────────────────────────────────────────

const GUMLOOP_API_BASE = 'https://api.gumloop.com/api/v1';
const POLL_INTERVAL_MS = 1_500;
const MAX_WAIT_MS = 25_000;

// ── Main Interpreter ─────────────────────────────────────────────────────────

/**
 * Forwards a Telegram message to the Gumloop agent for AI interpretation.
 *
 * Flow:
 *  1. POST /start_agent → kicks off the Gumloop agent with the user's message
 *  2. Poll GET /agent_status/{interaction_id} until COMPLETED or FAILED
 *  3. Extract the last assistant message and return it
 *
 * Required env vars (set in Vercel):
 *  - GUMLOOP_API_KEY     — Gumloop API key (Bearer token)
 *  - GUMLOOP_USER_ID     — Gumloop user ID (owner of the agent)
 *  - GUMLOOP_GUMMIE_ID   — The Gumloop agent/gummie ID to call
 */
export async function interpretTelegramMessage(
  message: string,
  userId: string,
): Promise<string> {
  const apiKey = process.env.GUMLOOP_API_KEY;
  const gummieId = process.env.GUMLOOP_GUMMIE_ID;
  const gumloopUserId = process.env.GUMLOOP_USER_ID;

  if (!apiKey || !gummieId || !gumloopUserId) {
    return 'AI features not configured. Use slash commands:\n/mint <url> • /watch <address> • /status • /cancel • /settings';
  }

  addBreadcrumb({
    category: 'ai-interpreter',
    message: 'Forwarding to Gumloop agent',
    level: 'info',
    data: { userId, messageLength: message.length },
  });

  try {
    // ── Step 1: Start the agent ────────────────────────────────────────
    const startRes = await fetch(`${GUMLOOP_API_BASE}/start_agent`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        gummie_id: gummieId,
        user_id: gumloopUserId,
        message: `[AutoMint Telegram — user: ${userId}]\n\n${message}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!startRes.ok) {
      const errorText = await startRes.text().catch(() => 'unknown');
      logger.warn('Gumloop start_agent failed', {
        area: 'ai-interpreter',
        status: startRes.status,
        error: errorText,
      });
      throw new Error(`Gumloop API error: ${startRes.status}`);
    }

    const startData = (await startRes.json()) as { interaction_id: string };
    const interactionId = startData.interaction_id;

    logger.info('Gumloop agent started', {
      area: 'ai-interpreter',
      interactionId,
      userId,
    });

    // ── Step 2: Poll for completion ────────────────────────────────────
    const deadline = Date.now() + MAX_WAIT_MS;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const statusRes = await fetch(
        `${GUMLOOP_API_BASE}/agent_status/${interactionId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(5_000),
        },
      );

      if (!statusRes.ok) continue;

      const status = (await statusRes.json()) as {
        state: string;
        messages?: Array<{ role: string; content: string }>;
        error_message?: string;
      };

      if (status.state === 'COMPLETED') {
        const assistantMessages =
          status.messages?.filter((m) => m.role === 'assistant') ?? [];
        const lastReply = assistantMessages.at(-1)?.content;

        logger.info('Gumloop agent completed', {
          area: 'ai-interpreter',
          interactionId,
          responseLength: lastReply?.length ?? 0,
        });

        return lastReply || 'Done.';
      }

      if (status.state === 'FAILED') {
        logger.warn('Gumloop agent failed', {
          area: 'ai-interpreter',
          interactionId,
          error: status.error_message,
        });
        return (
          status.error_message ??
          'AI processing failed. Try a slash command instead.'
        );
      }

      // Still PROCESSING — keep polling
    }

    // Timed out waiting for the agent
    logger.warn('Gumloop agent timeout', {
      area: 'ai-interpreter',
      interactionId,
      maxWaitMs: MAX_WAIT_MS,
    });

    return '⏳ Still processing your request. Check /status in a moment.';
  } catch (error) {
    await captureException(error, {
      area: 'ai-interpreter',
      context: { userId, messagePreview: message.slice(0, 100) },
      fingerprint: ['ai-interpreter', 'gumloop'],
    });
    throw error;
  }
}
