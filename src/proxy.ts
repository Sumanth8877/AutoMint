import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';

// ─── Protected routes ─────────────────────────────────────────────
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)', '/mints(.*)', '/wallets(.*)', '/analytics(.*)',
  '/settings(.*)', '/history(.*)', '/collections(.*)', '/analyzer(.*)',
  '/whale-tracker(.*)', '/admin(.*)',
  '/api/mints(.*)', '/api/wallets(.*)', '/api/analytics(.*)',
  '/api/analyzer(.*)', '/api/copy-mint(.*)', '/api/discovery(.*)',
  '/api/history(.*)', '/api/monitoring(.*)', '/api/search(.*)',
  '/api/settings(.*)', '/api/whale-tracker(.*)', '/api/watched-wallets(.*)',
  '/api/collections(.*)', '/api/activities(.*)', '/api/blockchain(.*)',
  '/api/telegram/link-token(.*)', '/api/wallet-reputation(.*)',
]);

// ─── CSP nonce ────────────────────────────────────────────────────
// Generates a unique nonce per request and attaches it via x-nonce header.
// layout.tsx reads this to pass nonce={nonce} to <ClerkProvider> and any
// inline scripts — replacing the blanket 'unsafe-inline' with targeted allow.
function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

export default clerkMiddleware(async (auth, request: NextRequest) => {
  if (isProtectedRoute(request)) {
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

  // Expose nonce to RSC (readable via headers() in layout.tsx)
  response.headers.set('x-nonce', nonce);

  return response;
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
    '/(api|trpc)(.*)',
  ],
};
