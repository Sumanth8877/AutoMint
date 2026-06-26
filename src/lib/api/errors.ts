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

// ── Route error handler ───────────────────────────────────────────────────────
//
// Typed AppError subclasses carry their own status code — no string matching.
// Plain Error fallback infers status from common message patterns so services
// that haven't yet adopted AppError still return the right HTTP code.
//
// Usage in a route catch block:
//   } catch (err) {
//     return handleRouteError(err, 'Failed to add collection');
//   }

export function handleRouteError(error: unknown, fallback: string): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
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
