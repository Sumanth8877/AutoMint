// ─────────────────────────────────────────────────────────────────────────────
// Next.js 16+ runs the Clerk middleware from `src/proxy.ts` (the renamed
// convention that replaced `src/middleware.ts` in v16). DO NOT rename this
// file back to `middleware.ts` on Next 16+ — and if you ever downgrade to
// Next ≤ 15, rename it back, otherwise Clerk auth will silently stop running.
// ─────────────────────────────────────────────────────────────────────────────
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
]);

// ─── Bearer token detection ───────────────────────────────────────────
// API routes that carry a Bearer token (e.g. "am_..." from the API key system)
// should NOT be blocked by Clerk's auth.protect(). Instead, they pass through
// to the route handler where requireApiUser() validates the token.
function hasBearerToken(request: NextRequest): boolean {
  // L-02 fix: only the app's own API keys (prefixed "am_") may bypass Clerk.
  // Previously ANY "Bearer <anything>" header skipped auth.protect(), so a
  // browser extension or misconfigured client sending a stray Bearer header
  // would bypass Clerk and hit requireApiUser() with a confusing 401.
  const authHeader = request.headers.get('authorization');
  return Boolean(authHeader?.startsWith('Bearer am_'));
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

  // M1: CSP is applied as a static header in next.config.ts. Clerk's hosted UI
  // requires 'unsafe-inline' for scripts/styles in production, so a per-request
  // CSP nonce is NOT used (a nonce-based policy would mean dropping 'unsafe-inline',
  // which breaks Clerk). The previous x-nonce header was generated but read nowhere
  // — removed as dead code.
  return NextResponse.next();
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
    '/(api|trpc)(.*)',
  ],
};
