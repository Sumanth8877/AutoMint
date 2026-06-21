import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { isAdminSession } from '@/lib/auth/require-auth';
import InfrastructureTestingClient from './testing-client';

export default async function InfrastructureTestingPage() {
  const session = await auth();
  if (!session.userId || !isAdminSession(session.userId, session.sessionClaims as Record<string, unknown> | null)) {
    notFound();
  }

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Infrastructure Testing"
        description="Run real production integration checks across messaging, cache, queueing, database, RPC, parsing, crawling, and observability."
      />
      <InfrastructureTestingClient />
    </div>
  );
}
