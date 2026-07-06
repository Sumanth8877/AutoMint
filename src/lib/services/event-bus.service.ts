import 'server-only';

import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';

// ── Event Types ──────────────────────────────────────────────────────────────
// Each event maps to one or more React Query keys the browser should invalidate.

export type EventType =
  | 'wallet:created'
  | 'wallet:updated'
  | 'wallet:removed'
  | 'wallet:balance'
  | 'watched-wallet:created'
  | 'watched-wallet:removed'
  | 'whale:activity'
  | 'copy-rule:created'
  | 'copy-rule:deleted'
  | 'mint:created'
  | 'mint:cancelled'
  | 'mint:retried'
  | 'mint:completed'
  | 'mint:failed'
  | 'collection:discovered'
  | 'collection:removed'
  | 'collection:floor-refreshed'
  | 'analyzer:completed'
  | 'settings:updated'
  | 'monitoring:website-added'
  | 'monitoring:website-removed'
  | 'data:reset'
  | 'ai:provider-switch';

export interface BusEvent {
  type: EventType;
  ts: number;
  /** Optional extra context (e.g. taskId, walletId) */
  meta?: Record<string, unknown>;
}

// ── Query key mapping ────────────────────────────────────────────────────────
// Maps event types → React Query keys the browser should invalidate.

export const EVENT_TO_QUERY_KEYS: Record<EventType, string[]> = {
  'wallet:created':              ['wallets'],
  'wallet:updated':              ['wallets'],
  'wallet:removed':              ['wallets'],
  'wallet:balance':              ['wallets'],
  'watched-wallet:created':      ['watched-wallets'],
  'watched-wallet:removed':      ['watched-wallets'],
  'whale:activity':              ['whale-activity'],
  'copy-rule:created':           ['copy-mint-rules'],
  'copy-rule:deleted':           ['copy-mint-rules'],
  'mint:created':                ['mints', 'mint-history'],
  'mint:cancelled':              ['mints', 'mint-history'],
  'mint:retried':                ['mints', 'mint-history'],
  'mint:completed':              ['mints', 'mint-history', 'analytics', 'collections'],
  'mint:failed':                 ['mints', 'mint-history', 'analytics'],
  'collection:discovered':       ['collections'],
  'collection:removed':          ['collections'],
  'collection:floor-refreshed':  ['collections'],
  'analyzer:completed':          ['analyzer-history', 'analyzer-history-recent'],
  'settings:updated':            ['execution-settings', 'notification-settings', 'email-notifications'],
  'monitoring:website-added':    ['monitoring-websites'],
  'monitoring:website-removed':  ['monitoring-websites'],
  'data:reset':                  ['wallets', 'mints', 'collections', 'analytics', 'mint-history', 'watched-wallets', 'copy-mint-rules'],
  'ai:provider-switch':          ['ai-status'],
};

// ── Redis key helpers ────────────────────────────────────────────────────────

const STREAM_KEY = (userId: string) => `events:${userId}`;
const MAX_STREAM_LEN = 200;        // keep last 200 events per user
const STREAM_TTL_SECONDS = 3600;   // auto-expire after 1h of inactivity

// ── Publish ──────────────────────────────────────────────────────────────────

/**
 * Publish an event to the user's Redis stream.
 * Called from executeTool() after any mutation succeeds.
 */
export async function publishEvent(
  userId: string,
  type: EventType,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const event: BusEvent = { type, ts: Date.now(), meta };

    // LPUSH + LTRIM = bounded list acting as a lightweight stream
    const key = STREAM_KEY(userId);
    await redis.lpush(key, JSON.stringify(event));
    await redis.ltrim(key, 0, MAX_STREAM_LEN - 1);
    await redis.expire(key, STREAM_TTL_SECONDS);

    logger.info('Event published', { area: 'event-bus', type, userId });
  } catch (err) {
    // Non-critical — don't let event publishing break the tool execution
    logger.warn('Event publish failed', {
      area: 'event-bus',
      type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Poll (for SSE endpoint) ──────────────────────────────────────────────────

/**
 * Read events newer than `sinceTs` for a user.
 * Returns events in chronological order (oldest first).
 */
export async function pollEvents(
  userId: string,
  sinceTs: number,
): Promise<BusEvent[]> {
  try {
    const redis = getRedisClient();
    const key = STREAM_KEY(userId);
    const raw = await redis.lrange(key, 0, MAX_STREAM_LEN - 1) as string[];
    if (!raw || raw.length === 0) return [];

    const events: BusEvent[] = [];
    for (const item of raw) {
      try {
        const parsed = (typeof item === 'string' ? JSON.parse(item) : item) as BusEvent;
        if (parsed.ts > sinceTs) {
          events.push(parsed);
        }
      } catch {
        // skip malformed entries
      }
    }

    // Return oldest-first
    return events.reverse();
  } catch {
    return [];
  }
}
