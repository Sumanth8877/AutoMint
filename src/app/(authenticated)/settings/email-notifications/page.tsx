import EmailNotificationsClient from './email-notifications-client';

// Cache this page for 4 hours
export const revalidate = 14400;

export default function EmailNotificationsPage() {
  return <EmailNotificationsClient />;
}
