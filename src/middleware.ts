import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// C-8 fix: Centralised Clerk auth at the edge -- runs before any route handler.
// Every route is protected by default. Exceptions are listed explicitly below.
//
// Public routes (no Clerk auth required -- they use their own verification):
//   /sign-in, /sign-up        - Clerk auth pages
//   /api/webhooks/*           - Alchemy + QStash use HMAC signature verification
//   /api/telegram/webhook     - uses TELEGRAM_WEBHOOK_SECRET timing-safe check
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)',
  '/api/telegram/webhook',
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
