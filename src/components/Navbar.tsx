'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';
import { Menu, X, Hexagon } from 'lucide-react';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/collections', label: 'Collections' },
  { href: '/wallets', label: 'Wallets' },
  { href: '/history', label: 'History' },
  { href: '/settings', label: 'Settings' },
];

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { isSignedIn } = useUser();

  const isActive = (href: string) => pathname === href;

  return (
    <nav
      className="sticky top-0 z-50 h-20"
      style={{
        background: 'rgba(5,8,22,0.7)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(59,130,246,0.1)',
      }}
    >
      <div className="max-w-7xl mx-auto px-8 h-full">
        <div className="flex items-center justify-between h-full">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative">
              <Hexagon
                size={28}
                className="text-blue-500 transition-all duration-300 group-hover:text-blue-400"
                strokeWidth={1.5}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2 h-2 rounded-sm bg-blue-500 rotate-45 group-hover:bg-blue-400 transition-colors" />
              </div>
            </div>
            <span
              className="text-lg font-bold tracking-tight leading-none"
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}
            >
              <span className="text-white">AUTO</span>{' '}
              <span className="text-[#3B82F6]">MINT</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium transition-colors duration-200 ${
                  isActive(link.href)
                    ? 'text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox:
                      'w-8 h-8 rounded-full ring-2 ring-blue-500/30 ring-offset-2 ring-offset-[#050816]',
                  },
                }}
              />
            ) : (
              <SignInButton mode="modal">
                <button
                  className="px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all duration-300"
                  style={{
                    background: 'linear-gradient(90deg, #2563EB, #3B82F6)',
                    boxShadow: '0 4px 15px rgba(59,130,246,0.3)',
                  }}
                >
                  Sign In
                </button>
              </SignInButton>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden text-slate-300 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div
          className="md:hidden border-t"
          style={{ borderColor: 'rgba(59,130,246,0.1)', background: 'rgba(11,17,32,0.98)' }}
        >
          <div className="px-6 py-4 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-3 text-sm font-medium rounded-xl transition-all ${
                  isActive(link.href)
                    ? 'text-white bg-blue-500/10 border border-blue-500/20'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}