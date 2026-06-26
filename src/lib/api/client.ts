export class ApiClientError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: unknown) {
    super(message);
    this.name = 'ApiClientError';
  }
}

// React Query (used throughout the app) handles client-side caching via its
// staleTime / gcTime configuration. A separate in-memory Map cache was
// redundant — it grew unboundedly over long sessions, never evicted entries
// proactively, and fought with React Query's cache invalidation on mutations.
// Removed: apiCache Map, CACHE_TTL constant, getCacheKey/getCachedData/setCachedData helpers.
type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | Record<string, unknown> | null;
};

export async function apiRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams) && !(body instanceof Blob)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  const response = await fetch(url, { ...options, headers, body: body as BodyInit | null | undefined });
  const payload = await response.json().catch(() => null) as { error?: string } | T | null;

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && payload.error
      ? payload.error
      : 'Request failed';
    throw new ApiClientError(message, response.status, payload);
  }

  return payload as T;
}
