/**
 * app/(authenticated)/settings/system/page.tsx
 *
 * Settings → System Maintenance
 *
 * Server component wrapper for admin-only system settings.
 * Redirects non-admin users back to /settings.
 */

import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db';
import { users } from '@/drizzle/schema';
import { eq } from 'drizzle-orm';
import { DependencyUpdateCenter } from '@/components/settings/DependencyUpdateCenter';

async function isAdmin(clerkId: string): Promise<boolean> {
  const adminIds = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (adminIds.length === 0 && adminEmails.length === 0) return false;

  const [user] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!user) return false;

  if (adminIds.includes(user.id)) return true;
  if (adminEmails.includes(user.email.toLowerCase())) return true;

  return false;
}

export default async function SystemMaintenancePage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const admin = await isAdmin(clerkId);
  if (!admin) redirect('/settings');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
        <a href="/settings" className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
          Settings
        </a>
        <span>/</span>
        <span className="text-gray-700 dark:text-gray-300">System Maintenance</span>
      </nav>

      {/* Page header */}
      <div className="border-b border-gray-200 dark:border-gray-700 pb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-50">
          System Maintenance
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Admin-only tools for keeping AutoMint healthy and up to date.
        </p>
      </div>

      {/* Dependency Update Center */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <DependencyUpdateCenter />
      </div>
    </div>
  );
}
