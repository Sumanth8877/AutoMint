'use client';

import React from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { Wallet, Layers, Zap, ArrowUpRight } from 'lucide-react';

const features = [
  {
    icon: Wallet,
    title: 'Wallet Management',
    description:
      'Connect and manage multiple wallets with real-time balance tracking across all your networks.',
  },
  {
    icon: Layers,
    title: 'Collection Tracking',
    description:
      'Track NFT collections, mint schedules, floor prices, and important metrics in real time.',
  },
  {
    icon: Zap,
    title: 'Mint Automation',
    description:
      'Automate public mint workflows with configurable strategies and live status updates.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050816] relative overflow-hidden">
      {/* Subtle background effects — purely atmospheric */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-[-120px] left-[-120px] w-[400px] h-[400px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)',
            filter: 'blur(100px)',
          }}
        />
        <div
          className="absolute bottom-[-120px] right-[-120px] w-[400px] h-[400px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(124,58,237,0.05) 0%, transparent 70%)',
            filter: 'blur(100px)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: [
              'linear-gradient(rgba(59,130,246,0.3) 1px, transparent 1px)',
              'linear-gradient(90deg, rgba(59,130,246,0.3) 1px, transparent 1px)',
            ].join(', '),
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <Navbar />

      <main className="relative z-10">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">

          {/* ========== HERO ========== */}
          {/* Navbar is 80px. Push content well below it. */}
          <section className="pt-32 sm:pt-36 lg:pt-40 pb-20 sm:pb-28 lg:pb-36">
            <div className="max-w-4xl mx-auto text-center">

              {/* Badge */}
              <div
                className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full mb-10"
                style={{
                  background: 'rgba(59,130,246,0.06)',
                  border: '1px solid rgba(59,130,246,0.12)',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: '#3B82F6', boxShadow: '0 0 6px rgba(59,130,246,0.6)' }}
                />
                <span className="text-sm font-medium text-slate-400">Premium NFT Dashboard</span>
              </div>

              {/* Heading — occupies ~55% of viewport width at max, never collapses */}
              <h1
                className="text-[clamp(2.5rem,5vw,4.5rem)] font-bold text-white leading-[1.15] mb-8 tracking-tight"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                <span className="block">Mint NFTs Faster.</span>
                <span
                  className="block bg-clip-text text-transparent"
                  style={{
                    backgroundImage: 'linear-gradient(135deg, #FFFFFF 0%, #3B82F6 60%, #60A5FA 100%)',
                  }}
                >
                  Public Mints.
                </span>
                <span
                  className="block bg-clip-text text-transparent"
                  style={{
                    backgroundImage: 'linear-gradient(135deg, #FFFFFF 0%, #3B82F6 60%, #60A5FA 100%)',
                  }}
                >
                  Real-Time Tracking.
                </span>
              </h1>

              {/* Subtitle — comfortable spacing, readable width */}
              <p
                className="text-base sm:text-lg lg:text-xl text-slate-400 max-w-[640px] mx-auto leading-relaxed mb-12"
              >
                Automate public NFT mint tracking, manage wallets, and monitor
                collections from one premium dashboard.
              </p>

              {/* Buttons — 40px below subtitle, 60px above stats */}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
                <Link href="/sign-up">
                  <button
                    className="group inline-flex items-center gap-2.5 px-7 py-3 text-sm font-semibold text-white rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
                    style={{
                      background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                      boxShadow: '0 8px 30px rgba(59,130,246,0.3)',
                    }}
                  >
                    Get Started
                    <ArrowUpRight
                      size={16}
                      className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </button>
                </Link>
                <Link href="/dashboard">
                  <button
                    className="group inline-flex items-center gap-2.5 px-7 py-3 text-sm font-semibold rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
                    style={{
                      background: 'rgba(17,24,39,0.6)',
                      border: '1px solid rgba(59,130,246,0.15)',
                      color: '#FFFFFF',
                    }}
                  >
                    Launch App
                    <ArrowUpRight size={16} className="text-slate-500 group-hover:text-slate-300 transition-colors" />
                  </button>
                </Link>
              </div>

              {/* Stats — 60px below buttons */}
              <div
                className="max-w-2xl mx-auto rounded-2xl p-5"
                style={{
                  background: 'rgba(17,24,39,0.3)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  border: '1px solid rgba(59,130,246,0.06)',
                }}
              >
                <div className="grid grid-cols-3 gap-6">
                  {[
                    { value: '10K+', label: 'Active Mints' },
                    { value: '50K+', label: 'Wallets Tracked' },
                    { value: '99.9%', label: 'Uptime' },
                  ].map((stat, i) => (
                    <div key={i} className="text-center">
                      <div
                        className="text-xl sm:text-2xl font-bold mb-0.5"
                        style={{
                          fontFamily: 'Space Grotesk, sans-serif',
                          background: 'linear-gradient(135deg, #3B82F6, #60A5FA)',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                        }}
                      >
                        {stat.value}
                      </div>
                      <div className="text-xs sm:text-sm text-slate-500">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </section>

          {/* ========== DIVIDER ========== */}
          <div className="border-t border-blue-500/5" />

          {/* ========== FEATURES ========== */}
          {/* 120px+ spacing above features */}
          <section className="pt-28 pb-28 lg:pt-32 lg:pb-32">
            {/* Section heading */}
            <div className="text-center mb-16">
              <h2
                className="text-3xl sm:text-4xl font-bold text-white mb-3"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                Everything you need to{' '}
                <span style={{ color: '#3B82F6' }}>mint smarter</span>
              </h2>
              <p className="text-base sm:text-lg text-slate-500 max-w-lg mx-auto">
                Powerful tools for serious collectors and minters
              </p>
            </div>

            {/* Cards — equal heights, centered grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {features.map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={i}
                    className="group transition-all duration-500 hover:-translate-y-0.5"
                    style={{
                      background: 'rgba(17,24,39,0.4)',
                      backdropFilter: 'blur(16px)',
                      WebkitBackdropFilter: 'blur(16px)',
                      border: '1px solid rgba(59,130,246,0.06)',
                      borderRadius: '24px',
                      padding: '36px 32px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(59,130,246,0.2)';
                      e.currentTarget.style.boxShadow = '0 0 30px rgba(59,130,246,0.06), 0 0 60px rgba(59,130,246,0.03)';
                      e.currentTarget.style.background = 'rgba(17,24,39,0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(59,130,246,0.06)';
                      e.currentTarget.style.boxShadow = 'none';
                      e.currentTarget.style.background = 'rgba(17,24,39,0.4)';
                    }}
                  >
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-105"
                      style={{
                        background: 'rgba(59,130,246,0.08)',
                        border: '1px solid rgba(59,130,246,0.1)',
                      }}
                    >
                      <Icon size={24} style={{ color: '#3B82F6' }} />
                    </div>
                    <h3
                      className="text-lg font-semibold text-white mb-3"
                      style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                    >
                      {feature.title}
                    </h3>
                    <p className="text-sm text-slate-400 leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ========== BOTTOM CTA ========== */}
          <section className="pb-28 lg:pb-32">
            <div
              className="max-w-xl mx-auto text-center rounded-2xl p-12"
              style={{
                background: 'linear-gradient(135deg, rgba(59,130,246,0.04), rgba(124,58,237,0.04))',
                border: '1px solid rgba(59,130,246,0.08)',
              }}
            >
              <h2
                className="text-2xl sm:text-3xl font-bold text-white mb-3"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                Ready to start minting?
              </h2>
              <p className="text-sm sm:text-base text-slate-400 mb-6">
                Join thousands of collectors using AutoMint to stay ahead.
              </p>
              <Link href="/sign-up">
                <button
                  className="px-8 py-3 text-sm font-semibold text-white rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
                  style={{
                    background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                    boxShadow: '0 8px 30px rgba(59,130,246,0.3)',
                  }}
                >
                  Get Started Free
                </button>
              </Link>
            </div>
          </section>

          {/* ========== FOOTER ========== */}
          <footer className="pb-10 text-center text-sm text-slate-600">
            <p>© 2026 AutoMint. All rights reserved.</p>
          </footer>

        </div>
      </main>
    </div>
  );
}