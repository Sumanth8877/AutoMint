'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Wallet, History, Settings, Zap, X, Menu } from 'lucide-react';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/mints', label: 'Mints', icon: Zap },
  { href: '/wallets', label: 'Wallets', icon: Wallet },
  { href: '/history', label: 'Activity', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="lg:hidden fixed bottom-6 right-6 z-40 w-14 h-14 rounded-2xl flex items-center justify-center shadow-xl"
        style={{ background: 'linear-gradient(135deg, #2563EB, #3B82F6)' }}
        aria-label="Open navigation"
      >
        <Menu size={24} className="text-white" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl p-6 animate-slideUp" style={{ background: 'rgba(11,17,32,0.98)', border: '1px solid rgba(59,130,246,0.15)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Navigate</h2>
              <button onClick={() => setOpen(false)} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-white/5 transition-all" aria-label="Close navigation">
                <X size={20} />
              </button>
            </div>
            <nav className="space-y-1">
              {navLinks.map(link => {
                const Icon = link.icon;
                const active = pathname === link.href;
                return (
                  <Link key={link.href} href={link.href}
                    className={`flex items-center gap-3 px-4 py-3.5 text-base font-medium rounded-xl transition-all duration-200 ${
                      active ? 'text-white bg-blue-500/10 border border-blue-500/20' : 'text-slate-500 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon size={20} />
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}