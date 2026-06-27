import ApiKeysClient from './api-keys-client';

// Always render fresh so the env-var check is at request time.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ApiKeysPage() {
  const configured = Boolean(process.env.AUTOMINT_API_KEY);
  return <ApiKeysClient configured={configured} />;
}
