/**
 * src/lib/logger.ts
 *
 * Structured application logger backed by Sentry breadcrumbs.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('mint-lock', 'Lock acquired', { mintId, key });
 *   logger.warn('copy-mint', 'Fallback wallet used', { chain });
 *   logger.error('rpc', 'Provider unavailable', { provider, error });
 *
 * Why not console.log?
 *   - console.log writes unstructured noise to Vercel logs with no filtering
 *   - Sentry breadcrumbs are associated with error events, providing full trace context
 *   - addBreadcrumb is a no-op when Sentry is not configured (safe in all environments)
 */

import { addBreadcrumb } from '@/lib/observability/sentry';

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

function log(level: LogLevel, category: string, message: string, data?: Record<string, unknown>) {
  addBreadcrumb({ category, message, level, data });
}

export const logger = {
  debug: (category: string, message: string, data?: Record<string, unknown>) =>
    log('debug', category, message, data),

  info: (category: string, message: string, data?: Record<string, unknown>) =>
    log('info', category, message, data),

  warn: (category: string, message: string, data?: Record<string, unknown>) =>
    log('warning', category, message, data),

  error: (category: string, message: string, data?: Record<string, unknown>) =>
    log('error', category, message, data),
} as const;
