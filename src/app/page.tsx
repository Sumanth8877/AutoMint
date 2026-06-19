'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import MintUrlInput from '@/components/mint/MintUrlInput';
import { CheckCircle2, ExternalLink, Zap, Shield, Clock, Gauge } from 'lucide-react';

export default function HomePage() {
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async (url: string) => {
    setLoading(true);
    setAnalysis(null);
    await new Promise(r => setTimeout(r, 1800));
    setAnalysis({ status: 'live', collection: 'Bored Ape Yacht Club', chain: 'Ethereum', address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', price: '0.05', supply: '9,950 / 10,000' });
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#050816] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-120px] left-[-120px] w-[400px] h-[400px] rounded-full" style={{background:'radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)', filter:'blur(100px)'}} />
        <div className="absolute bottom-[-120px] right-[-120px] w-[400px] h-[400px] rounded-full" style={{background:'radial-gradient(circle, rgba(124,58,237,0.05) 0%, transparent 70%)', filter:'blur(100px)'}} />
      </div>

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[1280px] px-5 sm:px-8">
          <section className="pt-28 sm:pt-32 lg:pt-36">
            <div className="text-center">
              <h1 className="text-[clamp(2.5rem,5vw,3.75rem)] font-bold text-white leading-[1.12] tracking-tight max-w-[900px] mx-auto" style={{fontFamily:'Space Grotesk, sans-serif'}}>
                Mint NFTs Before Everyone Else
              </h1>
              <p className="mt-5 text-lg sm:text-xl text-slate-400 max-w-[700px] mx-auto leading-relaxed">
                Paste a mint URL. AutoMint detects requirements, checks mint status, and executes instantly when eligible.
              </p>
            </div>

            <div className="mt-10 max-w-[900px] mx-auto">
              <MintUrlInput onAnalyze={handleAnalyze} loading={loading} />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8 mt-7 text-sm text-slate-400">
              <span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Auto Detect Collection</span>
              <span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Verify Requirements</span>
              <span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Mint Instantly If Live</span>
              <span className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Schedule If Upcoming</span>
            </div>
          </section>

          <section className="pb-24">
            {loading && (
              <div className="max-w-[640px] mx-auto mt-14 rounded-2xl border border-blue-500/15 bg-[#111827]/60 backdrop-blur-2xl p-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <div className="w-4 h-4 rounded-full border-2 border-blue-500/40 border-t-blue-500 animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Analyzing collection...</p>
                    <p className="text-xs text-slate-500 mt-0.5">Resolving intent, fetching requirements</p>
                  </div>
                </div>
              </div>
            )}

            {analysis && !loading && (
              <div className="max-w-[640px] mx-auto mt-14 rounded-2xl border border-blue-500/15 bg-[#111827]/60 backdrop-blur-2xl p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <p className="text-lg font-bold text-white">{analysis.collection}</p>
                    <p className="text-sm text-slate-400 mt-0.5">
                      {analysis.address.slice(0,10)}...{analysis.address.slice(-8)} · {analysis.chain}
                    </p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-green-500/10 text-green-500 border border-green-500/20">
                    <span className="w-[6px] h-[6px] rounded-full bg-green-500 animate-pulse" />
                    Live
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                  <div className="rounded-xl bg-[#0B1120]/60 border border-blue-500/10 p-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wide">Price</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{analysis.price} ETH</p>
                  </div>
                  <div className="rounded-xl bg-[#0B1120]/60 border border-blue-500/10 p-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wide">Supply</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{analysis.supply}</p>
                  </div>
                  <div className="rounded-xl bg-[#0B1120]/60 border border-blue-500/10 p-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wide">Chain</p>
                    <p className="text-sm font-semibold text-white mt-0.5">{analysis.chain}</p>
                  </div>
                  <div className="rounded-xl bg-[#0B1120]/60 border border-blue-500/10 p-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wide">Status</p>
                    <p className="text-sm font-semibold text-green-500 mt-0.5">Live</p>
                  </div>
                </div>
                <button className="mt-6 w-full py-5 rounded-2xl text-base font-bold transition-all duration-300 hover:-translate-y-0.5" style={{background:'linear-gradient(135deg, #22C55E, #16A34A)', color:'#FFFFFF', boxShadow:'0 10px 30px rgba(34,197,94,0.35)'}}>
                  <span className="inline-flex items-center justify-center gap-2">⚡ MINT NOW</span>
                </button>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}