import { PageHeader } from '@/components/ui/page-header';
import InfrastructureTestingClient from './testing-client';

export default async function InfrastructureTestingPage() {
  return (
    <div>
      <PageHeader
        title="Infrastructure Testing"
        description="Run real production integration checks across messaging, cache, queueing, database, RPC, parsing, crawling, and observability."
      />
      <InfrastructureTestingClient />
    </div>
  );
}
