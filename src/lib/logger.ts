import 'server-only';

// ── Log levels ────────────────────────────────────────────────────────────────
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ── Structured log entry ──────────────────────────────────────────────────────
type LogEntry = {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
};

// ── Core emit ─────────────────────────────────────────────────────────────────
//
// Each log line does two things:
//
//   1. Writes a structured JSON line to stdout (info/debug) or stderr (warn/error).
//      Vercel captures these and makes them searchable in the Functions log dashboard.
//      Format: { "level": "info", "message": "...", "ts": "...", ...context }
//
//   2. Structured logging for debugging.
//      Breadcrumbs do NOT appear in Vercel logs on their own — that's the gap
//      this function closes.
//
// L-02 fix: defense-in-depth redaction. No call site in this codebase
// currently logs a secret (verified by audit), but the logger itself had no
// safety net -- any future accidental `logger.info('...', { privateKey })`
// would leak verbatim into Vercel's log dashboard. This redacts any context
// key whose name looks sensitive, recursively, before serializing.
const SENSITIVE_KEY_PATTERN = /(private[_-]?key|secret|password|token|api[_-]?key|encrypted|authorization|signature)/i;
const REDACTED = '[REDACTED]';
const MAX_REDACTION_DEPTH = 5;

function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth >= MAX_REDACTION_DEPTH || value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = redactSensitive(val, depth + 1);
    }
  }
  return result;
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const safeContext = context && Object.keys(context).length > 0
    ? (redactSensitive(context) as Record<string, unknown>)
    : undefined;

  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(safeContext ? { context: safeContext } : {}),
  };

  // ── Stdout / stderr (Vercel log dashboard) ───────────────────────────────
  // Flatten the entry so Vercel can index individual fields.
  const line = JSON.stringify({
    level: entry.level,
    msg: entry.message,
    ts: entry.timestamp,
    ...entry.context,
  });

  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }

}

// ── Public API ─────────────────────────────────────────────────────────────────

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) =>
    emit('debug', message, context),

  info: (message: string, context?: Record<string, unknown>) =>
    emit('info', message, context),

  warn: (message: string, context?: Record<string, unknown>) =>
    emit('warn', message, context),

  error: (message: string, context?: Record<string, unknown>) =>
    emit('error', message, context),
};

export default logger;
