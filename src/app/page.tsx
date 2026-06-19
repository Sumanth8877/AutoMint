'use client';
import React from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import MintUrlInput from '@/components/mint/MintUrlInput';
import { Zap, Shield, Clock, Gauge } from 'lucide-react';

const workflow = [
  { icon: Zap, title: 'Auto-detect Collection', desc: 'Paste any mint URL. We resolve the contract, chain, and collection automatically.' },
  { icon: Shield, title: 'Verify Requirements', desc: 'We check supply, price, mint status, and wallet eligibility before execution.' },
  { icon: Clock, title: 'Mint Instantly if Live', desc: 'When the mint is active, we execute immediately with optimized gas and speed.' },
  { icon: Gauge, title: 'Schedule if Upcoming', desc: 'If the mint is not live yet, we prepare and schedule it to run at open.' },
];

const trust = [
  { title: 'Fast Execution', desc: 'Sub-second broadcast with optimized nonce management.' },
  { title: 'Multi-RPC Reliability', desc: 'Automatic failover across leading RPC providers.' },
  { title: 'Fixed Gas Strategy', desc: 'Predictable costs without surprise gas spikes.' },
  { title: 'Smart Retry Engine', desc: 'Automatic recovery from temporary failures.' },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#050816] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-120px] left-[-120px] w-[400px] h-[400px] rounded-full" style={{background:'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)', filter:'blur(100px)'}} />
        <div className="absolute bottom-[-120px] right-[-120px] w-[400px] h-[400px] rounded-full" style={{background:'radial-gradient(circle, rgba(124,58,237,0.05) 0%, transparent 70%)', filter:'blur(100px)'}} />
        <div className="absolute inset-0 opacity-[0.015]" style={{backgroundImage:'linear-gradient(rgba(59,130,246,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.3) 1px, transparent 1px)', backgroundSize:'60px 60px'}} />
      </div>

      <Navbar />

      <main className="relative z-10">
        <div className="max-w-[1280px] mx-auto px-6 lg:px-8">
          <section className="pt-28 sm:pt-32 lg:pt-36 pb-16 sm:pb-24">
            <div className="text-center mb-12">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight tracking-tight max-w-[900px] mx-auto" style={{fontFamily:'Space Grotesk, sans-serif'}}>
                Paste an NFT mint URL
              </h1>
              <p className="mt-5 text-lg text-slate-400 max-w-[700px] mx-auto leading-relaxed">
                AutoMint detects the collection, checks status, and mints instantly if live — or schedules it for the drop.
              </p>
            </div>

            <div className="max-w-[800px] mx-auto">
              <MintUrlInput onAnalyze={(url) => { window.location.href = `/dashboard?url=${encodeURIComponent(url)}`; }} />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-8 mt-8 text-sm text-slate-500">
              <span className="flex items-center gap-2"><Zap size={16} className="text-blue-500" /> Auto-detect collection</span>
              <span className="flex items-center gap-2"><Shield size={16} className="text-blue-500" /> Verify requirements</span>
              <span className="flex items-center gap-2"><Clock size={16} className="text-blue-500" /> Schedule upcoming</span>
            </div>

            <div className="flex items-center justify-center mt-10">
              <Link href="/dashboard">
                <button className="px-7 py-3 text-sm font-semibold text-white rounded-2xl transition-all duration-300 hover:-translate-y-0.5" style={{background:'rgba(17,24,39,0.6)', border:'1px solid rgba(59,130,246,0.2)', color:'#FFFFFF'}}>
                  Launch Dashboard
                </button>
              </Link>
            </div>
          </section>

          <section className="pb-20 sm:pb-28">
            <div className="text-center mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold text-white" style={{fontFamily:'Space Grotesk, sans-serif'}}>How it works</h2>
              <p className="mt-2 text-slate-500">From URL to mint in seconds</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {workflow.map((item) => (
                <div key={item.title} className="rounded-2xl p-6 border border-blue-500/10 bg-[#111827]/80 backdrop-blur-xl">
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
                    <item.icon size={20} className="text-blue-500" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-1">{item.title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="pb-20 sm:pb-28">
            <div className="rounded-2xl p-8 sm:p-10 border border-blue-500/10 bg-[#111827]/80 backdrop-blur-xl">
              <div className="text-center mb-8">
                <h2 className="text-2xl sm:text-3xl font-bold text-white" style={{fontFamily:'Space Grotesk, sans-serif'}}>Built for reliability</h2>
                <p className="mt-2 text-slate-500">Infrastructure-grade mint execution</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {trust.map((item) => (
                  <div key={item.title} className="rounded-xl p-5 border border-blue-500/10 bg-[#0B1120]/60">
                    <h4 className="text-sm font-semibold text-white mb-1">{item.title}</h4>
                    <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}