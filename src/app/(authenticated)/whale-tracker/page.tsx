import WhaleTrackerClient from './whale-tracker-client';

// Cache this page for 1 hour
export const revalidate = 3600;

export default function WhaleTrackerPage() {
  return <WhaleTrackerClient />;
}
