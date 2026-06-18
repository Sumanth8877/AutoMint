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
      {/* Subtle atmospheric background */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Top-left soft blue glow */}
        <div
          className="absolute top-[-100px] left-[-100px] w-[400px] h-[400px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        {/* Bottom-right soft purple glow */}
        <div
          className="absolute bottom-[-100px] right-[-100px] w-[400px] h-[400px] rounded-full"
          style={{
            background: 'radial-gradient(circle, rgba(124,58,237,0.06) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
        {/* Subtle center ambient glow */}
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[300px]"
          style={{
            background: 'radial-gradient(ellipse, rgba(59,130,246,0.03) 0%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        {/* Grid texture overlay */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(59,130,246,0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(59,130,246,0.3) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      <Navbar />

      {/* Hero */}
      <main className="relative z-10">
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          {/* Spacing: 100px below navbar */}
          <div className="pt-28" />

          {/* Hero Content */}
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge — Space below: 32px */}
            <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full mb-8"
              style={{
                background: 'rgba(59,130,246,0.06)',
                border: '1px solid rgba(59,130,246,0.12)',
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]"
                style={{ boxShadow: '0 0 6px rgba(59,130,246,0.6)' }}
              />
              <span className="text-sm font-medium text-slate-400">Premium NFT Dashboard</span>
            </div>

            {/* Title — Space below: 24px */}
            <h1
              className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white leading-[1.1] mb-6 tracking-tight"
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}
            >
              Mint NFTs Faster.
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: 'linear-gradient(135deg, #FFFFFF 0%, #3B82F6 60%, #60A5FA 100%)',
                }}
              >
                Public Mints. Real-Time Tracking.
              </span>
            </h1>

            {/* Subtitle — Space below: 40px */}
            <p className="text-lg sm:text-xl text-slate-400 max-w-xl mx-auto mb-10 leading-relaxed">
              Automate public NFT mint tracking, manage wallets, and monitor
              collections from one premium dashboard.
            </p>

            {/* Buttons — Space below: 60px */}
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
          </div>

          {/* Stats Bar — Space below: 120px */}
          <div
            className="max-w-2xl mx-auto rounded-2xl p-5 mb-32"
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
                  <div className="text-xs sm:text-sm text-slate-500">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Feature Section */}
          <div className="pb-32">
            {/* Section Heading */}
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

            {/* Feature Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                      padding: '32px',
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
                    {/* Icon */}
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
                      className="text-lg font-semibold text-white mb-2"
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
          </div>

          {/* Bottom CTA */}
          <div className="pb-32">
            <div
              className="max-w-xl mx-auto text-center rounded-2xl p-10 relative overflow-hidden"
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
          </div>

          {/* Footer */}
          <div className="pb-8 text-center text-sm text-slate-600">
            <p>© 2026 AutoMint. All rights reserved.</p>
          </div>
        </div>
      </main>
    </div>
  );
}