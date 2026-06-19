import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { syncUser } from '@/lib/auth/sync-user';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect('/sign-in');
  }

  await syncUser();

  return (
    <div className="min-h-screen bg-[#050816]">
      <Navbar />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full min-h-[calc(100vh-64px)]">
          {children}
        </main>
      </div>
    </div>
  );
}