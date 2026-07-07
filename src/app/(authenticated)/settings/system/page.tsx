import { redirect } from 'next/navigation';

// System page removed — redirect to main settings
export default function SystemPage() {
  redirect('/settings');
}
