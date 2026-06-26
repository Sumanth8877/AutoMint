import MintsClient from './mints-client';

// Disable cache so UI reflects mutations immediately
export const revalidate = 0;

export default function MintsPage() {
  return <MintsClient />;
}
