import ApiKeysClient from './api-keys-client';

// Always render fresh on each request so the env-var-backed key is read
// at request time, not at build time. (No revalidation cache — the key
// may rotate at any moment via Vercel env vars.)
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ApiKeysPage() {
  // Server-side read of the env-var. The value never appears on the wire
  // until the authenticated page is rendered for an authenticated user;
  // Clerk middleware (proxy.ts) guards the route.
  const apiKey = process.env.AUTOMINT_API_KEY ?? '';
  return <ApiKeysClient apiKey={apiKey} />;
}
