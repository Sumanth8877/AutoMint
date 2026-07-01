/**
 * app/(authenticated)/settings/system/page.tsx
 *
 * Settings → System → Dependency Update Center
 */

import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { DependencyUpdateCenter } from '@/components/settings/DependencyUpdateCenter';

// Always fresh — dependency state changes frequently
export const revalidate = 0;

export default async function SystemMaintenancePage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black tracking-tight text-text">System</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Dependency audits and package updates for AutoMint.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <DependencyUpdateCenter />
      </div>
    </div>
  );
}
