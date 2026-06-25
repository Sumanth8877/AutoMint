import EmailNotificationsClient from './email-notifications-client';

// Cache this page for 1 hour
export const revalidate = 3600;

export default function EmailNotificationsPage() {
  return <EmailNotificationsClient />;
}
