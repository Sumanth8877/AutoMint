import ApiKeysClient from './api-keys-client';

// Cache this page for 1 hour
export const revalidate = 3600;

export default function ApiKeysPage() {
  return <ApiKeysClient />;
}
