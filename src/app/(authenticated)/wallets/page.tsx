import WalletsClient from './wallets-client';

// Disable cache so UI reflects mutations immediately
export const revalidate = 0;

export default function WalletsPage() {
  return <WalletsClient />;
}
