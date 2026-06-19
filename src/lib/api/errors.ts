export function getErrorMessage(error: unknown, fallback = 'Request failed') {
  return error instanceof Error ? error.message : fallback;
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error('Invalid JSON request body');
  }
}
