import HistoryClient from './history-client';

// Cache this page for 4 hours
export const revalidate = 14400;

export default function HistoryPage() {
  return <HistoryClient />;
}
