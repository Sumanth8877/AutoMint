import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Routes that should be accessible without Clerk session authentication.
// API routes use their own Bearer-token auth via requireApiUser(),
// so Clerk should not block them.
const isPublicRoute = createRouteMatcher([
  // Auth pages
  '/sign-in(.*)',
  '/sign-up(.*)',
  // Public API routes — health, webhooks, keepalive
  '/api/health',
  '/api/webhooks/(.*)',
  '/api/system/alchemy-webhook',
  '/api/system/keepalive',
  '/api/telegram/webhook',
  // All API routes — requireApiUser() handles Bearer token auth internally
  '/api/(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  // Match all routes except static files and Next.js internals
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
