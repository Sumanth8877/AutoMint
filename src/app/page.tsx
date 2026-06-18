'use client';

import React from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import { Wallet, Layers, Zap } from 'lucide-react';

const features = [
  {
    icon: Wallet,
    title: 'Wallet Management',
    description:
      'Connect and manage multiple wallets with real-time balance tracking.',
  },
  {
    icon: Layers,
    title: 'Collection Tracking',
    description:
      'Track NFT collections, mint schedules, and important metrics.',
  },
  {
    icon: Zap,
    title: 'Mint Automation',
    description:
      'Automate public mint workflows with real-time updates.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050816] relative overflow-hidden">
      {/* Background Glow Effects */}
      <div
        className="absolute top-[-200px] left-[-200px] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: 'rgba(59,130,246,0.15)',
          filter: 'blur(120px)',
        }}
      />
      <div
        className="absolute bottom-[-300px] right-[-200px] w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{
          background: 'rgba(124,58,237,0.12)',
          filter: 'blur(150px)',
        }}
      />

      <Navbar />

      {/* Hero Section */}
      <main className="relative z-10">
        <div className="max-w-6xl mx-auto pt-32 pb-24 px-6 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8"
            style={{
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.2)',
            }}
          >
            <span className="w-2 h-2 rounded-full bg-[#3B82F6] animate-pulse" />
            <span className="text-sm" style={{ color: '#94A3B8' }}>
              Premium NFT Dashboard
            </span>
          </div>

          {/* Title */}
          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight mb-6"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            Mint NFTs Faster.
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(135deg, #FFFFFF 0%, #3B82F6 100%)',
              }}
            >
              Public Mints. Real-Time Tracking.
            </span>
          </h1>

          {/* Subtitle */}
          <p
            className="text-xl mx-auto mb-10 leading-relaxed max-w-[700px]"
            style={{ color: '#94A3B8' }}
          >
            Automate public NFT mint tracking, manage wallets, and monitor
            collections from one premium dashboard.
          </p>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/dashboard">
              <button
                className="px-8 py-3 text-base font-semibold text-white rounded-xl transition-all duration-300 hover:-translate-y-0.5"
                style={{
                  background: 'linear-gradient(90deg, #2563EB, #3B82F6)',
                  boxShadow: '0 4px 20px rgba(59,130,246,0.35)',
                }}
              >
                Get Started
              </button>
            </Link>
            <Link href="/dashboard">
              <button
                className="px-8 py-3 text-base font-semibold rounded-xl transition-all duration-300 hover:-translate-y-0.5"
                style={{
                  background: 'rgba(17,24,39,0.8)',
                  border: '1px solid rgba(59,130,246,0.2)',
                  color: '#FFFFFF',
                }}
              >
                View Dashboard
              </button>
            </Link>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="max-w-6xl mx-auto px-6 pb-32">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div
                  key={i}
                  className="group transition-all duration-300 hover:-translate-y-1"
                  style={{
                    height: '220px',
                    background: 'rgba(17,24,39,0.6)',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    border: '1px solid rgba(59,130,246,0.1)',
                    borderRadius: '24px',
                    padding: '32px',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor =
                      'rgba(59,130,246,0.3)';
                    e.currentTarget.style.boxShadow =
                      '0 0 20px rgba(59,130,246,0.1), 0 0 40px rgba(59,130,246,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor =
                      'rgba(59,130,246,0.1)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                    style={{
                      background: 'rgba(59,130,246,0.1)',
                      border: '1px solid rgba(59,130,246,0.15)',
                    }}
                  >
                    <Icon
                      size={22}
                      className="text-[#3B82F6] group-hover:scale-110 transition-transform duration-300"
                    />
                  </div>
                  <h3
                    className="text-lg font-semibold text-white mb-2"
                    style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                  >
                    {feature.title}
                  </h3>
                  <p style={{ color: '#94A3B8' }} className="text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}