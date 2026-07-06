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
function emit(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
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
