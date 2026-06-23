import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';
import { monitoredWebsites, monitoringEvents } from '@/drizzle/schema/monitoring';
import { eq } from 'drizzle-orm';
import { setCache } from '@/lib/redis';
import {
  createBrowserSession,
  openPage,
  closeBrowserSession,
  computeSnapshotHash,
  type BrowserbaseSession,
  type BrowserbaseSnapshot,
} from '@/lib/browserbase/client';

const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || '';

/**
 * M-8 fix: define simpleHash — was called in createSnapshot but never defined.
 * The missing function caused a ReferenceError on every HTTP snapshot check,
 * silently crashing the entire website monitoring path at runtime.
 * Uses SHA-256 truncated to 16 hex chars — stable, fast, collision-resistant.
 */
function simpleHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ─── Snapshot shape ──────────────────────────────
export interface WebsiteSnapshot {
  url: string;
  title: string;
  statusCode: number;
  contentHash: string;
  checkedAt: string;
}

// ─── Simple HTTP check (no browserbase) ──────────

export async function createSnapshot(url: string): Promise<WebsiteSnapshot> {
  const timestamp = new Date().toISOString();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15000),
    });

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Simple content hash from HTML text
    const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const contentHash = simpleHash(textContent + title);

    return {
      url,
      title,
      statusCode: response.status,
      contentHash,
      checkedAt: timestamp,
    };
  } catch {
    return {
      url,
      title: '',
      statusCode: 0,
      contentHash: '',
      checkedAt: timestamp,
    };
  }
}

// ─── Browserbase Snapshot ─────────────────────────

export async function createBrowserSnapshot(url: string): Promise<BrowserbaseSnapshot> {
  if (!BROWSERBASE_PROJECT_ID) {
    throw new Error('Browserbase not configured: BROWSERBASE_PROJECT_ID required');
  }

  let session: BrowserbaseSession | null = null;
  try {
    session = await createBrowserSession({ projectId: BROWSERBASE_PROJECT_ID, timeoutMinutes: 2 });

    const snapshot = await openPage({
      sessionId: session.id,
      url,
      waitUntil: 'domcontentloaded',
    });

    return snapshot;
  } finally {
    // Best-effort cleanup
    try {
      if (session?.id) await closeBrowserSession(session.id);
    } catch {}
  }
}

// ─── Snapshot Comparison ──────────────────────────

export function compareSnapshots(
  previous: WebsiteSnapshot | null | undefined,
  current: WebsiteSnapshot,
): { changed: boolean; reason: string | null } {
  if (!previous) {
    return { changed: true, reason: 'first_check' };
  }

  if (previous.statusCode !== current.statusCode) {
    return { changed: true, reason: `status_code_changed: ${previous.statusCode} → ${current.statusCode}` };
  }

  if (previous.contentHash !== current.contentHash) {
    return { changed: true, reason: 'content_changed' };
  }

  return { changed: false, reason: null };
}

// ─── Create Monitoring Event ──────────────────────

export async function createMonitoringEvent(params: {
  websiteId: string;
  eventType: 'PAGE_CHANGED' | 'SITE_OFFLINE' | 'SITE_ONLINE' | 'CONTENT_CHANGED';
  severity?: string;
  oldSnapshot?: WebsiteSnapshot;
  newSnapshot: WebsiteSnapshot;
  metadata?: Record<string, unknown>;
}) {
  const [event] = await getDb().insert(monitoringEvents).values({
    websiteId: params.websiteId,
    eventType: params.eventType,
    severity: params.severity || 'info',
    oldSnapshot: params.oldSnapshot ?? null,
    newSnapshot: params.newSnapshot,
    metadata: params.metadata || {},
  }).returning();
  return event;
}

// ─── Website Monitoring Service ───────────────────
// Called from cron handler

export async function checkWebsite(websiteId: string): Promise<{
  success: boolean;
  changed: boolean;
  eventCreated: boolean;
  snapshotHash: string;
  eventType?: string;
  reason?: string | null;
}> {
  // 1. Fetch website from DB
  const [website] = await getDb()
    .select()
    .from(monitoredWebsites)
    .where(eq(monitoredWebsites.id, websiteId))
    .limit(1);

  if (!website) {
    throw new Error(`Website not found: ${websiteId}`);
  }

  if (!website.enabled) {
    return { success: true, changed: false, eventCreated: false, snapshotHash: '', reason: null };
  }

  // 2. Determine if check is due
  if (website.lastCheckedAt) {
    const lastChecked = new Date(website.lastCheckedAt).getTime();
    const intervalMs = website.checkIntervalMinutes * 60 * 1000;
    if (Date.now() - lastChecked < intervalMs) {
      return { success: true, changed: false, eventCreated: false, snapshotHash: website.lastSnapshotHash || '', reason: null };
    }
  }

  // 3. Create snapshot (Browserbase if configured, otherwise HTTP fallback)
  let snapshot: WebsiteSnapshot;
  let snapshotHash: string;

  try {
    if (BROWSERBASE_PROJECT_ID && website.browserSessionId) {
      const bbSnapshot = await createBrowserSnapshot(website.url);
      snapshot = {
        url: bbSnapshot.url,
        title: bbSnapshot.title,
        statusCode: 200,
        contentHash: bbSnapshot.htmlHash || bbSnapshot.textHash,
        checkedAt: bbSnapshot.timestamp,
      };
    } else {
      snapshot = await createSnapshot(website.url);
    }
    snapshotHash = computeSnapshotHash(snapshot);
  } catch (error) {
    // Site offline or error
    const errorSnapshot: WebsiteSnapshot = {
      url: website.url,
      title: '',
      statusCode: 0,
      contentHash: '',
      checkedAt: new Date().toISOString(),
    };
    snapshotHash = computeSnapshotHash(errorSnapshot);

    await createMonitoringEvent({
      websiteId,
      eventType: 'SITE_OFFLINE',
      severity: 'error',
      oldSnapshot: (website.lastSnapshot as WebsiteSnapshot | null) || undefined,
      newSnapshot: errorSnapshot,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });

    await getDb()
      .update(monitoredWebsites)
      .set({ lastStatus: 'error', lastCheckedAt: new Date(), lastSnapshot: errorSnapshot, lastSnapshotHash: snapshotHash })
      .where(eq(monitoredWebsites.id, websiteId));

    return { success: true, changed: true, eventCreated: true, snapshotHash, eventType: 'SITE_OFFLINE', reason: 'error' };
  }

  // 4. Compare with previous snapshot
  const prevSnapshot = (website.lastSnapshot as WebsiteSnapshot | null) || undefined;
  const { changed, reason } = compareSnapshots(prevSnapshot, snapshot);

  // 5. Create event if changed
  let eventCreated = false;
  if (changed && reason !== 'first_check') {
    const eventType: 'PAGE_CHANGED' | 'CONTENT_CHANGED' = reason?.startsWith('status_code') ? 'PAGE_CHANGED' : 'CONTENT_CHANGED';

    await createMonitoringEvent({
      websiteId,
      eventType,
      severity: 'info',
      oldSnapshot: prevSnapshot,
      newSnapshot: snapshot,
      metadata: { reason },
    });
    eventCreated = true;
  }

  // 6. Update website record
  const newStatus: 'changed' | 'no_change' = changed ? 'changed' : 'no_change';
  await getDb()
    .update(monitoredWebsites)
    .set({
      lastStatus: newStatus,
      lastCheckedAt: new Date(),
      lastSnapshot: snapshot,
      lastSnapshotHash: snapshotHash,
      lastChangeAt: changed ? new Date() : website.lastChangeAt,
    })
    .where(eq(monitoredWebsites.id, websiteId));

  // 7. Cache snapshot in Redis (DB is source of truth)
  const cacheKey = `website:snapshot:${websiteId}`;
  await setCache(cacheKey, { snapshot, changed, snapshotHash }, 1800); // 30 minutes

  return {
    success: true,
    changed,
    eventCreated,
    snapshotHash: snapshotHash || '',
    eventType: changed ? (reason?.startsWith('status_code') ? 'PAGE_CHANGED' : 'CONTENT_CHANGED') : undefined,
    reason,
  };
}
