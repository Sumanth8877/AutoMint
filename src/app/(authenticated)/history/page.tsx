import HistoryClient from './history-client';

// Cache this page for 1 hour
export const revalidate = 3600;

export default function HistoryPage() {
  return <HistoryClient />;
}
