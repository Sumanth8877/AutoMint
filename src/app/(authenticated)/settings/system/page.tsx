/**
 * app/(authenticated)/settings/system/page.tsx
 */
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { MigrationBanner } from '@/components/settings/MigrationBanner';
import { SystemStatusPanel } from '@/components/settings/SystemStatusPanel';

export const revalidate = 0;

export default async function SystemMaintenancePage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-text">System</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Database migrations and system status for AutoMint.
        </p>
      </div>

      <SystemStatusPanel />

      <MigrationBanner />
      <MigrationBanner
        endpoint="/api/system/apply-collections-migration"
        tableLabel="collections"
        affectedFeature="Collections floor-price tracking"
      />
    </div>
  );
}
