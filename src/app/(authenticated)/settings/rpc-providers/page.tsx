import RpcProvidersClient from './rpc-providers-client';

// Cache this page for 4 hours
export const revalidate = 14400;

export default function RpcProvidersPage() {
  return <RpcProvidersClient />;
}
