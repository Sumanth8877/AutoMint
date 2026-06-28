/**
 * app/(authenticated)/settings/system/page.tsx
 *
 * Settings → System → Dependency Update Center
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
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-text">System</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Dependency audits and package updates for AutoMint.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-white/5 p-6 shadow-sm dark:bg-gray-900">
        <DependencyUpdateCenter />
      </div>
    </div>
  );
}
