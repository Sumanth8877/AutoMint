/**
 * app/(authenticated)/settings/system/page.tsx
 *
 * Settings → System Maintenance → Dependency Update Center
 *
 * Accessible to any authenticated user.
 */

import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { DependencyUpdateCenter } from '@/components/settings/DependencyUpdateCenter';

// Cache this page for 4 hours
export const revalidate = 14400;

export default async function SystemMaintenancePage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

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
          Tools for keeping AutoMint dependencies healthy and up to date.
        </p>
      </div>

      {/* Dependency Update Center */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm">
        <DependencyUpdateCenter />
      </div>
    </div>
  );
}
