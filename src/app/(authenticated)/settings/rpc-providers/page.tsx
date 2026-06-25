import RpcProvidersClient from './rpc-providers-client';

// Cache this page for 1 hour
export const revalidate = 3600;

export default function RpcProvidersPage() {
  return <RpcProvidersClient />;
}
