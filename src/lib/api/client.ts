export class ApiClientError extends Error {
  constructor(message: string, readonly status: number, readonly payload?: unknown) {
    super(message);
    this.name = 'ApiClientError';
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: BodyInit | Record<string, unknown> | null;
  skipCache?: boolean;
};

// Simple client-side cache with TTL
const apiCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 14400000; // 4 hours

function getCacheKey(url: string, options: RequestOptions): string {
  return `${url}:${JSON.stringify(options.method || 'GET')}`;
}

function getCachedData(key: string): unknown | null {
  const cached = apiCache.get(key);
  if (!cached) return null;
  
  const now = Date.now();
  if (now - cached.timestamp > CACHE_TTL) {
    apiCache.delete(key);
    return null;
  }
  
  return cached.data;
}

function setCachedData(key: string, data: unknown): void {
  apiCache.set(key, { data, timestamp: Date.now() });
}

export async function apiRequest<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body;

  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof URLSearchParams) && !(body instanceof Blob)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  const cacheKey = getCacheKey(url, options);
  
  // Return cached data for GET requests unless skipCache is true
  if (!options.skipCache && (!options.method || options.method === 'GET')) {
    const cached = getCachedData(cacheKey);
    if (cached) {
      return cached as T;
    }
  }

  const response = await fetch(url, { ...options, headers, body: body as BodyInit | null | undefined });
  const payload = await response.json().catch(() => null) as { error?: string } | T | null;

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && payload.error
      ? payload.error
      : 'Request failed';
    throw new ApiClientError(message, response.status, payload);
  }

  // Cache successful GET responses
  if (!options.skipCache && (!options.method || options.method === 'GET')) {
    setCachedData(cacheKey, payload);
  }

  return payload as T;
}
