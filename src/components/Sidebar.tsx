'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import {
  LayoutDashboard,
  Folders,
  Wallet,
  History,
  Settings,
  LogOut,
} from 'lucide-react';

const sidebarLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/collections', label: 'Collections', icon: Folders },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/history', label: 'History', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useUser();

  const isActive = (href: string) => pathname === href;

  return (
    <aside className="hidden lg:flex flex-col w-64 h-[calc(100vh-4rem)] sticky top-16 border-r border-blue-500/10 bg-[#0B1120]/50 backdrop-blur-xl">
      {/* Navigation */}
      <nav className="flex-1 px-3 py-6 space-y-1">
        {sidebarLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-xl transition-all duration-300 ${
                isActive(link.href)
                  ? 'text-white bg-blue-500/10 border border-blue-500/20'
                  : 'text-muted hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={18} />
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* User Profile Card */}
      <div className="p-4 border-t border-blue-500/10">
        <div className="card p-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
              {user?.firstName?.[0] || user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user?.fullName || 'User'}
              </p>
              <p className="text-xs text-muted truncate">
                {user?.primaryEmailAddress?.emailAddress || 'guest@automint.io'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}