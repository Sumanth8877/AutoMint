import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';

// ─── Protected routes ─────────────────────────────────────────────────
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)', '/mints(.*)', '/wallets(.*)', '/analytics(.*)',
  '/settings(.*)', '/history(.*)', '/collections(.*)', '/analyzer(.*)',
  '/whale-tracker(.*)',
  '/api/mints(.*)', '/api/wallets(.*)', '/api/analytics(.*)',
  '/api/analyzer(.*)', '/api/copy-mint(.*)', '/api/discovery(.*)',
  '/api/history(.*)', '/api/monitoring(.*)', '/api/search(.*)',
  '/api/settings(.*)', '/api/whale-tracker(.*)', '/api/watched-wallets(.*)',
  '/api/collections(.*)', '/api/activities(.*)', '/api/blockchain(.*)',
  '/api/telegram/link-token(.*)', '/api/wallet-reputation(.*)',
  '/api/api-keys(.*)',
]);

// ─── CSP nonce ────────────────────────────────────────────────────────
function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

// ─── Bearer token detection ───────────────────────────────────────────
// API routes that carry a Bearer token (e.g. "am_..." from the API key system)
// should NOT be blocked by Clerk's auth.protect(). Instead, they pass through
// to the route handler where requireApiUser() validates the token.
function hasBearerToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  return Boolean(authHeader?.startsWith('Bearer '));
}

function isApiRoute(request: NextRequest): boolean {
  return request.nextUrl.pathname.startsWith('/api/');
}

export default clerkMiddleware(async (auth, request: NextRequest) => {
  // API routes with Bearer tokens bypass Clerk protection —
  // requireApiUser() in the route handler validates the token.
  if (isProtectedRoute(request) && !(isApiRoute(request) && hasBearerToken(request))) {
    await auth.protect();
  }

  const nonce = generateNonce();

  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(request.headers.entries()),
        'x-nonce': nonce,
      }),
    },
  });

  response.headers.set('x-nonce', nonce);

  return response;
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
    '/(api|trpc)(.*)',
  ],
};
