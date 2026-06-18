'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';
import { Menu, X, Hexagon, ArrowUpRight } from 'lucide-react';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/collections', label: 'Collections' },
  { href: '/wallets', label: 'Wallets' },
  { href: '/history', label: 'History' },
  { href: '/settings', label: 'Settings' },
];

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const { isSignedIn } = useUser();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const isActive = (href: string) => pathname === href;

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 h-20 transition-all duration-300"
      style={{
        background: scrolled
          ? 'rgba(5,8,22,0.85)'
          : 'rgba(5,8,22,0.5)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: scrolled
          ? '1px solid rgba(59,130,246,0.12)'
          : '1px solid transparent',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8 h-full">
        <div className="flex items-center justify-between h-full">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group shrink-0">
            <div className="relative w-9 h-9 flex items-center justify-center">
              <Hexagon
                size={32}
                className="text-blue-500 transition-all duration-500 group-hover:text-blue-400"
                strokeWidth={1.5}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-sm bg-blue-500 rotate-45 group-hover:bg-blue-400 transition-colors duration-500" />
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className="text-xl font-bold tracking-tight text-white"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                AUTO
              </span>
              <span
                className="text-xl font-bold tracking-tight"
                style={{
                  fontFamily: 'Space Grotesk, sans-serif',
                  color: '#3B82F6',
                }}
              >
                MINT
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center absolute left-1/2 -translate-x-1/2">
            <div
              className="flex items-center gap-1 px-4 py-1.5 rounded-2xl"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                    isActive(link.href)
                      ? 'text-white bg-blue-500/10'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-4">
            {isSignedIn ? (
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard"
                  className="hidden sm:inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all duration-300 hover:opacity-90"
                  style={{
                    background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                    boxShadow: '0 4px 20px rgba(59,130,246,0.3)',
                  }}
                >
                  Launch App
                  <ArrowUpRight size={16} />
                </Link>
                <UserButton
                  appearance={{
                    elements: {
                      avatarBox:
                        'w-9 h-9 rounded-full ring-2 ring-blue-500/30 ring-offset-2 ring-offset-[#050816]',
                    },
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard"
                  className="hidden sm:inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all duration-300 hover:opacity-90"
                  style={{
                    background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                    boxShadow: '0 4px 20px rgba(59,130,246,0.3)',
                  }}
                >
                  Launch App
                  <ArrowUpRight size={16} />
                </Link>
                <SignInButton mode="modal">
                  <button className="px-5 py-2 text-sm font-medium text-slate-300 hover:text-white rounded-xl transition-all duration-200 hover:bg-white/5">
                    Sign In
                  </button>
                </SignInButton>
              </div>
            )}

            {/* Mobile menu */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden text-slate-300 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div
          className="lg:hidden border-t"
          style={{
            borderColor: 'rgba(59,130,246,0.1)',
            background: 'rgba(5,8,22,0.98)',
            backdropFilter: 'blur(24px)',
          }}
        >
          <div className="max-w-7xl mx-auto px-6 py-5 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-3 text-sm font-medium rounded-xl transition-all ${
                  isActive(link.href)
                    ? 'text-white bg-blue-500/10 border border-blue-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-3 border-t border-white/5 mt-3">
              {isSignedIn ? (
                <Link
                  href="/dashboard"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white rounded-xl"
                  style={{
                    background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                  }}
                >
                  Launch App <ArrowUpRight size={16} />
                </Link>
              ) : (
                <div className="space-y-2">
                  <Link
                    href="/dashboard"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white rounded-xl"
                    style={{
                      background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                    }}
                  >
                    Launch App <ArrowUpRight size={16} />
                  </Link>
                  <SignInButton mode="modal">
                    <button className="w-full px-5 py-3 text-sm font-medium text-slate-300 rounded-xl border border-white/10 hover:bg-white/5">
                      Sign In
                    </button>
                  </SignInButton>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}