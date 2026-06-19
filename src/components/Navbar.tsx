'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { Menu, X, Hexagon, ArrowUpRight } from 'lucide-react';

const navLinks = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/mints', label: 'Mints' },
  { href: '/wallets', label: 'Wallets' },
  { href: '/history', label: 'Activity' },
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
      className="fixed top-0 left-0 right-0 z-50 h-16 transition-all duration-300"
      style={{
        background: scrolled ? 'rgba(5,8,22,0.85)' : 'transparent',
        backdropFilter: scrolled ? 'blur(24px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(24px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(59,130,246,0.08)' : '1px solid transparent',
      }}
    >
      <div className="max-w-[1280px] mx-auto px-5 sm:px-8 h-full">
        <div className="flex items-center justify-between h-full">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative w-8 h-8 flex items-center justify-center">
              <Hexagon size={28} className="text-[#3B82F6] transition-all duration-500 group-hover:text-blue-400" strokeWidth={1.5} />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-2 h-2 rounded-sm bg-[#3B82F6] rotate-45 group-hover:bg-blue-400 transition-colors duration-500" />
              </div>
            </div>
            <span className="text-lg font-bold tracking-tight" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              <span className="text-white">AUTO</span>{' '}
              <span style={{ color: '#3B82F6' }}>MINT</span>
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center absolute left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-8">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className={`text-sm font-medium transition-all duration-200 relative ${isActive(link.href) ? 'text-white' : 'text-slate-400 hover:text-white'}`}>
                  {link.label}
                  {isActive(link.href) && <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full" style={{ background: '#3B82F6' }} />}
                </Link>
              ))}
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {isSignedIn ? (
              <Link
                href="/dashboard"
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all duration-300 hover:opacity-90"
                style={{
                  background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                  boxShadow: '0 4px 20px rgba(59,130,246,0.3)',
                }}
              >
                Launch App
                <ArrowUpRight size={15} />
              </Link>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href="/sign-up"
                  className="hidden sm:inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all duration-300 hover:opacity-90"
                  style={{
                    background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                    boxShadow: '0 4px 20px rgba(59,130,246,0.3)',
                  }}
                >
                  Get Started
                  <ArrowUpRight size={15} />
                </Link>
                <Link href="/sign-in" className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white rounded-xl transition-all duration-200">
                  Sign In
                </Link>
              </div>
            )}

            {/* Mobile menu */}
            <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden text-slate-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors">
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="lg:hidden border-t" style={{ borderColor: 'rgba(59,130,246,0.08)', background: 'rgba(5,8,22,0.98)', backdropFilter: 'blur(24px)' }}>
          <div className="max-w-[1280px] mx-auto px-5 py-5 space-y-1">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setMobileOpen(false)} className={`block px-4 py-3 text-sm font-medium rounded-xl transition-all ${isActive(link.href) ? 'text-white bg-blue-500/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                {link.label}
              </Link>
            ))}
            <div className="pt-4 border-t border-white/5 mt-4 space-y-2">
              <Link
                href={isSignedIn ? '/dashboard' : '/sign-in'}
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white rounded-xl"
                style={{ background: 'linear-gradient(135deg, #2563EB, #3B82F6)' }}
              >
                {isSignedIn ? 'Launch App' : 'Get Started'}
                <ArrowUpRight size={16} />
              </Link>
              {!isSignedIn && (
                <Link href="/sign-in" onClick={() => setMobileOpen(false)} className="block w-full text-center px-5 py-3 text-sm font-medium text-slate-400 rounded-xl border border-white/10 hover:bg-white/5">
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}