import 'server-only';

import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';

// ── Circuit Breaker for AI Providers ─────────────────────────────────────
//
// Tracks the health of each AI provider (Gemini, Nara) in Redis.
// When a provider fails N times consecutively, it's marked as "down".
// A background health probe periodically tests downed providers and
// restores them when they respond successfully.
//
// Gemini is ALWAYS the preferred provider. If Gemini is down, Nara is used.
// When Gemini recovers, traffic switches back automatically.

export type ProviderStatus = 'healthy' | 'degraded' | 'down';

export interface ProviderHealth {
  status: ProviderStatus;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  downSince: number | null;
  /** Which provider is actually serving requests right now */
  activeProvider: string | null;
}

// ── Config ───────────────────────────────────────────────────────────────

const FAILURE_THRESHOLD = 3;          // Mark "down" after 3 consecutive failures
const DEGRADED_THRESHOLD = 1;         // Mark "degraded" after 1 failure
const HEALTH_TTL_SECONDS = 3600;      // Redis key TTL (1 hour)
const HEALTH_KEY = (name: string) => `ai:health:${name.toLowerCase()}`;

// ── Redis helpers ────────────────────────────────────────────────────────

async function getHealth(providerName: string): Promise<ProviderHealth> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get<ProviderHealth>(HEALTH_KEY(providerName));
    if (raw) return raw;
  } catch { /* Redis unavailable — assume healthy */ }

  return {
    status: 'healthy',
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastError: null,
    downSince: null,
    activeProvider: null,
  };
}

async function setHealth(providerName: string, health: ProviderHealth): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(HEALTH_KEY(providerName), health, { ex: HEALTH_TTL_SECONDS });
  } catch { /* Non-critical */ }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Record a successful AI call for this provider.
 * Resets failure count and restores status to healthy.
 */
export async function recordSuccess(providerName: string): Promise<void> {
  const health = await getHealth(providerName);
  const wasDown = health.status === 'down';

  health.status = 'healthy';
  health.consecutiveFailures = 0;
  health.lastSuccessAt = Date.now();
  health.lastError = null;
  health.downSince = null;

  await setHealth(providerName, health);

  if (wasDown) {
    logger.info('AI provider recovered', { area: 'circuit-breaker', provider: providerName });
    // Notify all connected browsers that the provider is back
    // We don't have userId here — broadcast to all by using a wildcard approach
    // The SSE endpoint will pick it up on next poll
  }
}

/**
 * Record a failed AI call for this provider.
 * After FAILURE_THRESHOLD consecutive failures, marks provider as "down".
 */
export async function recordFailure(providerName: string, error: string): Promise<ProviderStatus> {
  const health = await getHealth(providerName);

  health.consecutiveFailures += 1;
  health.lastFailureAt = Date.now();
  health.lastError = error.slice(0, 300);

  if (health.consecutiveFailures >= FAILURE_THRESHOLD) {
    if (health.status !== 'down') {
      health.downSince = Date.now();
      logger.warn('AI provider marked DOWN', {
        area: 'circuit-breaker',
        provider: providerName,
        failures: health.consecutiveFailures,
        error: health.lastError,
      });
    }
    health.status = 'down';
  } else if (health.consecutiveFailures >= DEGRADED_THRESHOLD) {
    health.status = 'degraded';
  }

  await setHealth(providerName, health);
  return health.status;
}

/**
 * Check if a provider is currently considered healthy enough to use.
 */
export async function isProviderHealthy(providerName: string): Promise<boolean> {
  const health = await getHealth(providerName);
  return health.status !== 'down';
}

/**
 * Get the health status of a specific provider.
 */
export async function getProviderHealth(providerName: string): Promise<ProviderHealth> {
  return getHealth(providerName);
}

/**
 * Get the combined AI status for the dashboard.
 * Returns both provider healths + which one is currently active.
 */
export async function getAIStatus(): Promise<{
  gemini: ProviderHealth;
  nara: ProviderHealth;
  activeProvider: string;
  fallbackActive: boolean;
}> {
  const [gemini, nara] = await Promise.all([
    getHealth('gemini'),
    getHealth('nara'),
  ]);

  // Gemini is always preferred — it's the active provider unless it's down
  const geminiDown = gemini.status === 'down';
  const activeProvider = geminiDown ? 'Nara' : 'Gemini';
  const fallbackActive = geminiDown;

  return {
    gemini: { ...gemini, activeProvider },
    nara: { ...nara, activeProvider },
    activeProvider,
    fallbackActive,
  };
}
