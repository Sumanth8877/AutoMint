import { NextResponse } from 'next/server';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getErrorMessage(error: unknown, fallback = 'Request failed') {
  return error instanceof Error ? error.message : fallback;
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError('Invalid JSON request body');
  }
}

// ── AppError class hierarchy ──────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** 409 Conflict */
export class ConflictError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 409, code ?? 'CONFLICT');
  }
}

/** 400 Bad Request */
export class ValidationError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 400, code ?? 'VALIDATION_ERROR');
  }
}

/** 404 Not Found */
export class NotFoundError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 404, code ?? 'NOT_FOUND');
  }
}

/** 401 Unauthorized */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code?: string) {
    super(message, 401, code ?? 'UNAUTHORIZED');
  }
}

/** 403 Forbidden */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', code?: string) {
    super(message, 403, code ?? 'FORBIDDEN');
  }
}

// ── DB error detection ────────────────────────────────────────────────────────
//
// Drizzle / node-postgres / Neon errors stringify to messages like:
//   "Failed query: select \"id\", ... from \"api_keys\" where ... params: <uuid>"
// or carry SQLSTATE codes / driver-specific names. We must NEVER forward those
// to the client — they leak schema, query shape, and parameter values.

function isDbError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Driver class names (node-postgres, Neon serverless, postgres.js, Drizzle)
  const driverNames = new Set([
    'DatabaseError',     // node-postgres / pg
    'NeonDbError',       // @neondatabase/serverless
    'PostgresError',     // postgres.js
    'DrizzleError',
    'DrizzleQueryError',
  ]);
  if (driverNames.has(error.name)) return true;

  // Postgres SQLSTATE codes are 5 chars (e.g. "42P01" = undefined_table)
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return true;

  // Last-resort: Drizzle prefixes raw query errors with "Failed query:"
  if (error.message.startsWith('Failed query:')) return true;

  return false;
}

// ── Route error handler ───────────────────────────────────────────────────────
//
// Typed AppError subclasses carry their own status code — no string matching.
// Plain Error fallback infers status from common message patterns so services
// that haven't yet adopted AppError still return the right HTTP code.
// DB errors are NEVER forwarded verbatim — they're logged server-side and the
// client receives the generic `fallback` string with a 500.
//
// Usage in a route catch block:
//   } catch (err) {
//     return handleRouteError(err, 'Failed to add collection');
//   }

export function handleRouteError(error: unknown, fallback: string): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  // Database errors leak query text + params — log full detail server-side,
  // return only the generic fallback to the client.
  if (isDbError(error)) {
    console.error(`[handleRouteError] ${fallback}:`, error);
    return NextResponse.json({ error: fallback }, { status: 500 });
  }

  const message = getErrorMessage(error, fallback);
  const lower = message.toLowerCase();

  // Infer HTTP status from message for services not yet using AppError subclasses
  const status =
    lower.includes('not found')         ? 404 :
    lower.includes('already added')     ? 409 :
    lower.includes('already exists')    ? 409 :
    lower.includes('invalid json')      ? 400 :
    lower.includes('is required')       ? 400 :
    lower.includes('must be')           ? 400 :
    lower.includes('invalid')           ? 400 :
    lower.includes('unsupported')       ? 400 :
    lower.includes('unauthorized')      ? 401 :
    lower.includes('forbidden')         ? 403 :
    500;

  return NextResponse.json({ error: message }, { status });
}
