import 'server-only';

import fs from 'fs';
import path from 'path';
import { logger } from '@/lib/logger';

// ── Knowledge Base Service ────────────────────────────────────────────────────
// Reads AUTOMINT_GUIDE.md from the project root at runtime.
// The guide is cached in memory after the first read so subsequent calls are
// near-instant. Call invalidateGuideCache() to force a reload (useful in dev).
//
// The guide has two parts:
//   1. Human-written sections  — narrative, workflows, troubleshooting (edit manually)
//   2. Auto-generated sections — tool list, routes, services (run `npm run update-kb`)
// The entire file is injected into the AI system prompt so the AI can answer
// feature questions, explain workflows, and guide users through any task.

let cachedGuide: string | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000; // re-read the file at most once per minute

function getGuidePath(): string {
  // process.cwd() in Next.js points to the project root
  return path.join(process.cwd(), 'AUTOMINT_GUIDE.md');
}

/**
 * Returns the AutoMint user guide as a string.
 * Reads from AUTOMINT_GUIDE.md at the project root (cached for 60s).
 * Returns an empty string if the file is missing or unreadable.
 */
export function getKnowledgeBase(): string {
  const now = Date.now();
  if (cachedGuide !== null && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedGuide;
  }

  try {
    const filePath = getGuidePath();
    const content = fs.readFileSync(filePath, 'utf-8');
    cachedGuide = content;
    cacheLoadedAt = now;
    logger.info('Knowledge base loaded', {
      area: 'knowledge-base',
      chars: content.length,
      path: filePath,
    });
    return content;
  } catch (err) {
    logger.warn('Knowledge base unavailable', {
      area: 'knowledge-base',
      error: err instanceof Error ? err.message : String(err),
    });
    cachedGuide = '';
    cacheLoadedAt = now;
    return '';
  }
}

/** Force reload on next call (useful when AUTOMINT_GUIDE.md is edited). */
export function invalidateGuideCache(): void {
  cachedGuide = null;
  cacheLoadedAt = 0;
}
