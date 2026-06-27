import { clerkMiddleware } from '@clerk/nextjs/server';

// Minimal middleware scoped to API routes ONLY.
// - Pages are NOT affected (no skeleton loading issues)
// - API routes get Clerk's auth state without forced protection
// - requireApiUser() in each route handler enforces Bearer token auth
export default clerkMiddleware();

export const config = {
  // ONLY match API routes — pages never hit this middleware
  matcher: ['/(api)(.*)'],
};
