import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';

// ─── Routes that require authentication ──────────────────────────
const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/mints(.*)',
  '/wallets(.*)',
  '/analytics(.*)',
  '/settings(.*)',
  '/history(.*)',
  '/collections(.*)',
  '/analyzer(.*)',
  '/whale-tracker(.*)',
  '/admin(.*)',
  '/api/mints(.*)',
  '/api/wallets(.*)',
  '/api/analytics(.*)',
  '/api/analyzer(.*)',
  '/api/copy-mint(.*)',
  '/api/discovery(.*)',
  '/api/history(.*)',
  '/api/monitoring(.*)',
  '/api/search(.*)',
  '/api/settings(.*)',
  '/api/whale-tracker(.*)',
  '/api/watched-wallets(.*)',
  '/api/collections(.*)',
  '/api/activities(.*)',
  '/api/blockchain(.*)',
  '/api/telegram(.*)',
  '/api/wallet-reputation(.*)',
]);

// ─── CSP nonce generation ─────────────────────────────────────────
//
// Why nonces?
//   next.config.ts had 'unsafe-inline' in script-src to allow Clerk's
//   hosted UI inline scripts. 'unsafe-inline' in script-src completely
//   negates XSS protection — a nonce is the correct solution.
//
// How it works:
//   1. This middleware generates a unique nonce per request.
//   2. The nonce is set in the `x-nonce` response header so the
//      Next.js layout can read it and pass it to Clerk + any inline scripts.
//   3. next.config.ts reads the nonce from the CSP header context
//      (nonce: ... in the script-src directive).
//
// Usage in layout.tsx:
//   import { headers } from 'next/headers';
//   const nonce = (await headers()).get('x-nonce') ?? '';
//   // Pass nonce to Clerk <ClerkProvider nonce={nonce}>
//
function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

function buildCsp(nonce: string, isDev: boolean): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,             // allows inline scripts with this exact nonce
    'https://*.clerk.accounts.dev',
    'https://*.clerk.com',
    'https://clerk.com',
    ...(isDev ? ["'unsafe-eval'"] : []),  // only unsafe-eval in dev (HMR needs it)
    // NOTE: 'unsafe-inline' intentionally removed — replaced by nonce
  ].join(' ');

  const connectSrc = [
    "'self'",
    'https://*.clerk.accounts.dev',
    'https://*.clerk.com',
    'https://clerk.com',
    'https://api.clerk.com',
    'https://*.sentry.io',
    'https://sentry.io',
    'https://*.upstash.io',
    'https://*.neon.tech',
    'https://*.alchemy.com',
    'https://eth.llamarpc.com',
    ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
  ].join(' ');

  const imgSrc = [
    "'self'",
    'data:',
    'blob:',
    'https://img.clerk.com',
    'https://*.clerk.com',
    'https://*.seadn.io',
    'https://*.opensea.io',
    'https://ipfs.io',
    'https://*.ipfs.io',
  ].join(' ');

  return [
    `script-src ${scriptSrc}`,
    `connect-src ${connectSrc}`,
    `img-src ${imgSrc}`,
    "font-src 'self' https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  // style unsafe-inline is lower risk
    "frame-src https://*.clerk.accounts.dev https://clerk.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; ');
}

// ─── Clerk + nonce middleware ─────────────────────────────────────
export default clerkMiddleware(async (auth, request: NextRequest) => {
  // Protect authenticated routes
  if (isProtectedRoute(request)) {
    await auth.protect();
  }

  const isDev = process.env.NODE_ENV !== 'production';
  const nonce = generateNonce();
  const csp = buildCsp(nonce, isDev);

  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(request.headers.entries()),
        'x-nonce': nonce,
      }),
    },
  });

  // Set CSP header on response
  response.headers.set('Content-Security-Policy', csp);
  // Also expose nonce to the page (readable via headers() in RSC)
  response.headers.set('x-nonce', nonce);

  return response;
});

export const config = {
  matcher: [
    // Match all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?)$).*)',
    '/(api|trpc)(.*)',
  ],
};
