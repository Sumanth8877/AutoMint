import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { syncUser } from '@/lib/auth/sync-user';
import AppShell from '@/components/app-shell';
import OnboardingGate from '@/components/onboarding/onboarding-gate';
import { QueryClientProviderWrapper } from '@/components/providers/query-client-provider';

export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  // This layout re-runs on EVERY authenticated route (dashboard, mints,
  // wallets, settings, ...). syncUser() does a live Clerk API call
  // (currentUser()) plus a DB upsert — if either hiccups (rate limit,
  // transient Neon blip, Clerk API latency), it used to throw here
  // unguarded, which crashed the layout for the entire authenticated app
  // shell and every single page under it. Each page already calls
  // requireApiUser() -> syncUser(session.userId) independently and handles
  // failure gracefully (redirect/401), so this call is best-effort: sync
  // opportunistically, but never let it take down every route in the app.
  try {
    await syncUser();
  } catch (_e) {
  }

  return (
    <QueryClientProviderWrapper>
      <AppShell>
        <OnboardingGate>{children}</OnboardingGate>
      </AppShell>
    </QueryClientProviderWrapper>
  );
}
