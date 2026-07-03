/**
 * observability/sentry.ts
 *
 * Sentry has been removed. These are no-op stubs so existing imports
 * continue to compile without changes across the codebase.
 */

 
type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

 
type CaptureOptions = {
  level?: SentryLevel;
  area?: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  context?: Record<string, unknown>;
  fingerprint?: string[];
};

export function initSentry() {}

export function addBreadcrumb(_input: { category: string; message: string; level?: string; data?: Record<string, unknown> }) {}

export async function captureException(_error: unknown, _options?: CaptureOptions): Promise<string | null> {
  return null;
}

export async function captureMessage(_message: string, _options?: CaptureOptions): Promise<string | null> {
  return null;
}

export async function capturePerformance(_name: string, _durationMs: number, _options?: CaptureOptions): Promise<string | null> {
  return null;
}

export async function startSpan<T>(
  _name: string,
  _context: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}
