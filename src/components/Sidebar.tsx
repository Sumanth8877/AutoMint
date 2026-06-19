'use client';
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import {
  LayoutDashboard,
  Wallet,
  History,
  Settings,
  Zap,
} from 'lucide-react';

const sidebarLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/mints', label: 'Mints', icon: Zap },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/history', label: 'Activity', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const isActive = (href: string) => pathname === href;

  return (
    <aside className="hidden lg:flex flex-col w-64 h-[calc(100vh-4rem)] sticky top-16 border-r border-[rgba(255,255,255,0.06)] bg-[#05070A]">
      <nav className="flex-1 px-3 py-6 space-y-1">
        {sidebarLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                isActive(link.href)
                  ? 'text-white bg-[#4F8CFF]/10 border border-[#4F8CFF]/20'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={18} />
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-[rgba(255,255,255,0.06)]">
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#4F8CFF] to-[#3D7AE8] flex items-center justify-center text-white text-sm font-bold">
              {user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.fullName || 'User'}</p>
              <p className="text-xs text-white/40 truncate">{user?.primaryEmailAddress?.emailAddress || 'guest@automint.io'}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}