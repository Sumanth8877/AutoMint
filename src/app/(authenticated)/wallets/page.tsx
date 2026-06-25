import WalletsClient from './wallets-client';

// Cache this page for 1 hour
export const revalidate = 3600;

export default function WalletsPage() {
  return <WalletsClient />;
}
