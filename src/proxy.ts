import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { syncUser } from '@/lib/auth/sync-user';

const isProtectedPage = createRouteMatcher([
  '/dashboard(.*)',
  '/history(.*)',
  '/analytics(.*)',
  '/mints(.*)',
  '/wallets(.*)',
  '/settings(.*)',
  '/collections(.*)',
  '/analyzer(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedPage(request)) {
    await auth.protect();
  }

  const { userId } = await auth();
  if (!userId) return;

  try {
    await syncUser(userId);
  } catch (error) {
    console.error('User sync failed:', error);
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
