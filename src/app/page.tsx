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
    gradient: 'from-blue-500/20 to-blue-600/10',
  },
  {
    icon: Layers,
    title: 'Collection Tracking',
    description:
      'Track NFT collections, mint schedules, floor prices, and important metrics in real time.',
    gradient: 'from-purple-500/20 to-purple-600/10',
  },
  {
    icon: Zap,
    title: 'Mint Automation',
    description:
      'Automate public mint workflows with configurable strategies and live status updates.',
    gradient: 'from-cyan-500/20 to-cyan-600/10',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050816] relative overflow-hidden">
      {/* Premium Background Glows */}
      <div
        className="absolute top-[-300px] right-[-200px] w-[800px] h-[800px] rounded-full pointer-events-none animate-pulse"
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)',
          filter: 'blur(100px)',
        }}
      />
      <div
        className="absolute top-1/2 left-[-300px] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
          filter: 'blur(120px)',
        }}
      />
      <div
        className="absolute bottom-[-200px] right-[10%] w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)',
          filter: 'blur(100px)',
        }}
      />

      <Navbar />

      {/* Hero */}
      <main className="relative z-10 pt-36 pb-24">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-5xl mx-auto">
            {/* Premium Badge */}
            <div className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full mb-10">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(124,58,237,0.08))',
                  border: '1px solid rgba(59,130,246,0.15)',
                }}
              />
              <span
                className="relative w-2 h-2 rounded-full"
                style={{
                  background: '#3B82F6',
                  boxShadow: '0 0 8px rgba(59,130,246,0.6)',
                }}
              />
              <span className="relative text-sm font-medium" style={{ color: '#94A3B8' }}>
                Premium NFT Dashboard
              </span>
            </div>

            {/* Hero Title */}
            <h1
              className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-bold text-white leading-[1.05] mb-8 tracking-tight"
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}
            >
              Mint NFTs Faster.
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: 'linear-gradient(135deg, #FFFFFF 30%, #3B82F6 70%, #60A5FA 100%)',
                }}
              >
                Public Mints.
                <br />
                Real-Time Tracking.
              </span>
            </h1>

            {/* Subtitle */}
            <p
              className="text-lg sm:text-xl md:text-2xl mx-auto mb-12 leading-relaxed max-w-2xl"
              style={{ color: '#94A3B8' }}
            >
              Automate public NFT mint tracking, manage wallets, and monitor
              collections from one premium dashboard.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/sign-up">
                <button
                  className="group relative inline-flex items-center gap-2.5 px-8 py-3.5 text-base font-semibold text-white rounded-2xl transition-all duration-300 hover:-translate-y-0.5 active:translate-y-0"
                  style={{
                    background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                    boxShadow: '0 8px 32px rgba(59,130,246,0.35)',
                  }}
                >
                  <span>Get Started</span>
                  <ArrowUpRight
                    size={18}
                    className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </button>
              </Link>
              <Link href="/dashboard">
                <button
                  className="group inline-flex items-center gap-2.5 px-8 py-3.5 text-base font-semibold rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
                  style={{
                    background: 'rgba(17,24,39,0.8)',
                    border: '1px solid rgba(59,130,246,0.2)',
                    color: '#FFFFFF',
                  }}
                >
                  View Dashboard
                  <ArrowUpRight size={18} className="text-slate-400 group-hover:text-white transition-colors" />
                </button>
              </Link>
            </div>
          </div>

          {/* Stats Bar */}
          <div
            className="mt-24 max-w-3xl mx-auto rounded-2xl p-6"
            style={{
              background: 'rgba(17,24,39,0.4)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(59,130,246,0.08)',
            }}
          >
            <div className="grid grid-cols-3 gap-4 sm:gap-8">
              {[
                { value: '10K+', label: 'Active Mints' },
                { value: '50K+', label: 'Wallets Tracked' },
                { value: '99.9%', label: 'Uptime' },
              ].map((stat, i) => (
                <div key={i} className="text-center">
                  <div
                    className="text-2xl sm:text-3xl font-bold mb-1"
                    style={{
                      fontFamily: 'Space Grotesk, sans-serif',
                      background: 'linear-gradient(135deg, #3B82F6, #60A5FA)',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {stat.value}
                  </div>
                  <div className="text-xs sm:text-sm" style={{ color: '#94A3B8' }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feature Cards */}
          <div className="mt-32">
            <div className="text-center mb-16">
              <h2
                className="text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-4"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                Everything you need to{' '}
                <span className="text-[#3B82F6]">mint smarter</span>
              </h2>
              <p className="text-lg" style={{ color: '#94A3B8' }}>
                Powerful tools for serious collectors and minters
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
              {features.map((feature, i) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={i}
                    className="group relative overflow-hidden transition-all duration-500 hover:-translate-y-1"
                    style={{
                      background: 'rgba(17,24,39,0.5)',
                      backdropFilter: 'blur(24px)',
                      WebkitBackdropFilter: 'blur(24px)',
                      border: '1px solid rgba(59,130,246,0.08)',
                      borderRadius: '28px',
                      padding: '36px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(59,130,246,0.25)';
                      e.currentTarget.style.boxShadow =
                        '0 0 40px rgba(59,130,246,0.08), 0 0 80px rgba(59,130,246,0.04)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'rgba(59,130,246,0.08)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    {/* Inner glow */}
                    <div
                      className="absolute -top-20 -right-20 w-40 h-40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                      style={{
                        background: `radial-gradient(circle, ${feature.gradient.includes('blue') ? 'rgba(59,130,246,0.08)' : feature.gradient.includes('purple') ? 'rgba(124,58,237,0.08)' : 'rgba(6,182,212,0.08)'} 0%, transparent 70%)`,
                        filter: 'blur(30px)',
                      }}
                    />

                    {/* Icon */}
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-105 transition-transform duration-300"
                      style={{
                        background: 'rgba(59,130,246,0.08)',
                        border: '1px solid rgba(59,130,246,0.12)',
                      }}
                    >
                      <Icon
                        size={26}
                        style={{ color: '#3B82F6' }}
                        className="group-hover:scale-110 transition-transform duration-300"
                      />
                    </div>

                    {/* Content */}
                    <h3
                      className="text-xl font-semibold text-white mb-3"
                      style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                    >
                      {feature.title}
                    </h3>
                    <p style={{ color: '#94A3B8' }} className="text-base leading-relaxed">
                      {feature.description}
                    </p>

                    {/* Hover indicator */}
                    <div className="mt-6 flex items-center gap-1.5 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ color: '#3B82F6' }}>
                      <span>Learn more</span>
                      <ArrowUpRight size={14} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Bottom CTA */}
          <div className="mt-32 text-center">
            <div
              className="max-w-2xl mx-auto rounded-3xl p-12 relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(59,130,246,0.06), rgba(124,58,237,0.06))',
                border: '1px solid rgba(59,130,246,0.12)',
              }}
            >
              <div
                className="absolute -top-40 -right-40 w-80 h-80 rounded-full pointer-events-none"
                style={{
                  background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
                  filter: 'blur(60px)',
                }}
              />
              <h2
                className="text-3xl sm:text-4xl font-bold text-white mb-4 relative"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                Ready to start minting?
              </h2>
              <p className="text-lg mb-8 relative" style={{ color: '#94A3B8' }}>
                Join thousands of collectors using AutoMint to stay ahead.
              </p>
              <Link href="/sign-up" className="relative inline-block">
                <button
                  className="px-10 py-4 text-base font-semibold text-white rounded-2xl transition-all duration-300 hover:-translate-y-0.5"
                  style={{
                    background: 'linear-gradient(135deg, #2563EB, #3B82F6)',
                    boxShadow: '0 8px 32px rgba(59,130,246,0.35)',
                  }}
                >
                  Get Started Free
                </button>
              </Link>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-16 pb-8 text-center text-sm" style={{ color: '#64748B' }}>
            <p>© 2026 AutoMint. All rights reserved.</p>
          </div>
        </div>
      </main>
    </div>
  );
}