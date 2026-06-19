import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { syncUser } from '@/lib/auth/sync-user';
import Link from 'next/link';
import { Search, Bell, Settings, LayoutDashboard, Wallet, Activity, Settings as SettingsIcon } from 'lucide-react';

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
    <div className="min-h-screen bg-[#05070A]">
      {/* Navigation */}
      <nav className="border-b border-[rgba(255,255,255,0.06)] bg-[#05070A]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-white font-semibold text-lg">
              AutoMint
            </Link>
          </div>
          
          <div className="flex-1 max-w-xl mx-8">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                placeholder="Search..."
                className="w-full bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#4F8CFF] transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="p-2 text-white/60 hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
            </button>
            <Link href="/settings" className="p-2 text-white/60 hover:text-white transition-colors">
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </nav>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 border-r border-[rgba(255,255,255,0.06)] bg-[#05070A] min-h-[calc(100vh-64px)] p-4">
          <nav className="space-y-1">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 px-3 py-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="text-sm">Dashboard</span>
            </Link>
            <Link
              href="/wallets"
              className="flex items-center gap-3 px-3 py-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <Wallet className="w-4 h-4" />
              <span className="text-sm">Wallets</span>
            </Link>
            <Link
              href="/mints"
              className="flex items-center gap-3 px-3 py-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <Activity className="w-4 h-4" />
              <span className="text-sm">Mints</span>
            </Link>
            <Link
              href="/history"
              className="flex items-center gap-3 px-3 py-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <Activity className="w-4 h-4" />
              <span className="text-sm">History</span>
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-3 px-3 py-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <SettingsIcon className="w-4 h-4" />
              <span className="text-sm">Settings</span>
            </Link>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
          {children}
        </main>
      </div>
    </div>
  );
}