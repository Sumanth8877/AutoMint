import ProfileClient from './profile-client';

// Cache this page for 4 hours
export const revalidate = 14400;

export default function ProfilePage() {
  return <ProfileClient />;
}
