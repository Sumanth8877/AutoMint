'use client';

import React from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Button from '@/components/ui/Button';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050816] relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-[-200px] left-[-200px] w-[600px] h-[600px] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-300px] right-[-200px] w-[700px] h-[700px] rounded-full bg-blue-600/10 blur-[150px] pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-blue-400/5 blur-[200px] pointer-events-none" />

      {/* Navbar */}
      <Navbar />

      {/* Hero Section */}
      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32">
        <div className="text-center max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 mb-8">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-sm text-muted">Premium NFT Dashboard</span>
          </div>

          {/* Main Heading */}
          <h1
            className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-tight mb-6"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            Mint NFTs Faster.{' '}
            <span className="gradient-text">Public Mints. Real-Time Tracking.</span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
            Automate public NFT mint tracking, manage wallets, and monitor collections
            from one premium dashboard.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/dashboard">
              <Button variant="primary" size="lg" className="text-base px-10 py-3.5">
                Get Started
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button variant="secondary" size="lg" className="text-base px-10 py-3.5">
                View Dashboard
              </Button>
            </Link>
          </div>
        </div>

        {/* Feature Preview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-24">
          {[
            {
              title: 'Wallet Management',
              desc: 'Connect and manage multiple wallets in one place with real-time balance tracking.',
              icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M16 12h4v4h-4" />
                </svg>
              ),
            },
            {
              title: 'Collection Tracking',
              desc: 'Monitor NFT collections, floor prices, and mint progress from your dashboard.',
              icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20h16" />
                  <path d="M4 4v16" />
                  <path d="M8 16V8" />
                  <path d="M12 16V4" />
                  <path d="M16 16v-4" />
                </svg>
              ),
            },
            {
              title: 'Mint Automation',
              desc: 'Automate public mint processes with configurable strategies and real-time alerts.',
              icon: (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                  <line x1="8" y1="2" x2="8" y2="18" />
                  <line x1="16" y1="6" x2="16" y2="22" />
                </svg>
              ),
            },
          ].map((feature, i) => (
            <div
              key={i}
              className="card p-8 hover:border-blue-400/30 transition-all duration-500 group"
            >
              <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 inline-block mb-5 text-blue-500 group-hover:scale-110 transition-transform duration-300">
                {feature.icon}
              </div>
              <h3
                className="text-xl font-semibold text-white mb-3"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                {feature.title}
              </h3>
              <p className="text-muted leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}