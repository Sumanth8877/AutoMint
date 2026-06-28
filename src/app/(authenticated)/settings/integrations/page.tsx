import IntegrationsClient from './integrations-client';

// Always render fresh so the env-var check is at request time.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function IntegrationsPage() {
  const configured = Boolean(process.env.AUTOMINT_API_KEY);
  return <IntegrationsClient configured={configured} />;
}
