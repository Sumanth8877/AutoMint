'use client';
import React from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import MintUrlInput from '@/components/mint/MintUrlInput';
import { ArrowUpRight, Zap, Shield, Clock } from 'lucide-react';

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
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          <section className="pt-28 sm:pt-32 lg:pt-36 pb-20 sm:pb-28">
            <div className="text-center mb-14">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.15] tracking-tight" style={{fontFamily:'Space Grotesk, sans-serif'}}>
                Paste an NFT mint URL
              </h1>
              <p className="mt-5 text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
                AutoMint detects the collection, checks status, and mints instantly if live — or schedules it for the drop.
              </p>
            </div>

            <MintUrlInput onAnalyze={(url) => { window.location.href = `/dashboard?url=${encodeURIComponent(url)}`; }} />

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
        </div>
      </main>
    </div>
  );
}