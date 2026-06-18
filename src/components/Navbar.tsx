'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';
import { Menu, X } from 'lucide-react';

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
    <nav className="sticky top-0 z-50 glass border-b border-blue-500/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="text-blue-500 transition-all duration-300 group-hover:text-blue-400"
            >
              <path
                d="M12 2L2 7v10l10 5 10-5V7L12 2z"
                stroke="currentColor"
                strokeWidth="2"
                fill="none"
              />
              <path
                d="M12 6V18M8 8L16 16M8 16L16 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span
              className="text-lg font-bold tracking-tight"
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}
            >
              AUTO <span className="text-blue-500">MINT</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
                  isActive(link.href)
                    ? 'text-white bg-blue-500/10 border border-blue-500/20'
                    : 'text-muted hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <div className="flex items-center gap-3">
                <UserButton
                  appearance={{
                    elements: {
                      avatarBox: 'w-8 h-8 rounded-full ring-2 ring-blue-500/30',
                    },
                  }}
                />
              </div>
            ) : (
              <SignInButton mode="modal">
                <button className="btn-gradient text-white px-5 py-2 text-sm font-medium rounded-xl">
                  Sign In
                </button>
              </SignInButton>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden text-muted hover:text-white p-2 rounded-lg hover:bg-white/5"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="md:hidden border-t border-blue-500/10 bg-[#0B1120]/95 backdrop-blur-xl">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
                  isActive(link.href)
                    ? 'text-white bg-blue-500/10 border border-blue-500/20'
                    : 'text-muted hover:text-white hover:bg-white/5'
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