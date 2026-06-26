import { NextResponse } from 'next/server';

// ── Helpers (unchanged) ────────────────────────────────────────────────────────

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function parseJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ValidationError('Invalid JSON request body');
  }
}

// ── AppError class hierarchy ──────────────────────────────────────────────────
//
// Services throw typed errors; route handlers call handleRouteError(err) to
// map them to the correct HTTP status without brittle string matching.
//
// Usage in a service:
//   throw new ConflictError('Collection already added');
//   throw new ValidationError('contractAddress is required');
//   throw new NotFoundError('Wallet not found');
//
// Usage in a route handler catch block:
//   } catch (err) {
//     return handleRouteError(err, 'Failed to add collection');
//   }

export class AppError extends Error {
  constructor(
    message: string,
    /** HTTP status code this error maps to */
    readonly status: number,
    /** Optional machine-readable code for clients */
    readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** 409 Conflict — resource already exists or state prevents the action */
export class ConflictError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 409, code ?? 'CONFLICT');
  }
}

/** 400 Bad Request — invalid input, missing field, wrong type */
export class ValidationError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 400, code ?? 'VALIDATION_ERROR');
  }
}

/** 404 Not Found — resource does not exist or is not owned by this user */
export class NotFoundError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 404, code ?? 'NOT_FOUND');
  }
}

/** 401 Unauthorized — missing or invalid auth */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized', code?: string) {
    super(message, 401, code ?? 'UNAUTHORIZED');
  }
}

/** 403 Forbidden — authenticated but not permitted */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden', code?: string) {
    super(message, 403, code ?? 'FORBIDDEN');
  }
}

// ── Route error handler ───────────────────────────────────────────────────────
//
// Replaces brittle catch blocks like:
//   const status = message === 'X' ? 409 : message.includes('Y') ? 400 : 500;
//
// With a single call:
//   return handleRouteError(err, 'Failed to add collection');
//
// AppError subclasses carry their own status. Unknown errors → 500.

export function handleRouteError(
  error: unknown,
  fallback: string,
): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = getErrorMessage(error, fallback);
  return NextResponse.json({ error: message }, { status: 500 });
}
