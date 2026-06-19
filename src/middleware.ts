import { clerkMiddleware } from '@clerk/nextjs/server';
import { syncUser } from '@/lib/auth/sync-user';

export default clerkMiddleware(async (auth, request) => {
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