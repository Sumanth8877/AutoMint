import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { syncUser } from '@/lib/auth/sync-user';
import AppShell from '@/components/app-shell';

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  await syncUser();

  return (
    <AppShell>{children}</AppShell>
  );
}
