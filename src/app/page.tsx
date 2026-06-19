'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import MintUrlInput from '@/components/mint/MintUrlInput';

export default function HomePage() {
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async (url: string) => {
    setLoading(true);
    setAnalysis(null);
    await new Promise(r => setTimeout(r, 1800));
    setAnalysis({ status: 'live', collection: 'Bored Ape Yacht Club', chain: 'Ethereum', address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', price: '0.05', supply: '9,950 / 10,000', confidence: 98 });
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#050816] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[700px] rounded-full" style={{background:'radial-gradient(circle, rgba(59,130,246,0.14) 0%, transparent 70%)', filter:'blur(140px)'}} />
        <div className="absolute bottom-0 right-0 w-[700px] h-[500px] rounded-full" style={{background:'radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)', filter:'blur(120px)'}} />
      </div>

      <Navbar />

      <main className="relative z-10 pt-16">
        <div className="w-full max-w-[1280px] mx-auto px-5 sm:px-8 py-10 sm:py-16">
          <div className="max-w-[900px] mx-auto text-center mb-10">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold text-white leading-[1.05] tracking-tight" style={{fontFamily:'Space Grotesk, sans-serif'}}>
              <span className="block text-blue-500 text-sm font-semibold tracking-widest uppercase mb-3">AutoMint Execution Terminal</span>
              Mint NFTs Before Everyone Else
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-400 leading-relaxed">Paste any mint URL. AutoMint discovers mint requirements, prepares execution, and mints instantly when eligible.</p>
          </div>

          <div className="max-w-[900px] mx-auto">
            <MintUrlInput onAnalyze={handleAnalyze} loading={loading} />
          </div>

          {loading && (
            <div className="max-w-[640px] mx-auto mt-10 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5">
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
            <div className="max-w-[640px] mx-auto mt-10 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl p-5 sm:p-6 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <p className="text-lg font-bold text-white">{analysis.collection}</p>
                  <p className="text-sm text-slate-400 mt-0.5 break-all">{analysis.address.slice(0,10)}...{analysis.address.slice(-8)} · {analysis.chain}</p>
                </div>
                <span className="inline-flex w-fit items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-green-500/10 text-green-500 border border-green-500/20">
                  <span className="w-[6px] h-[6px] rounded-full bg-green-500 animate-pulse" /> Live
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Price</p>
                  <p className="text-sm font-semibold text-white mt-0.5">{analysis.price} ETH</p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Supply</p>
                  <p className="text-sm font-semibold text-white mt-0.5">{analysis.supply}</p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Confidence</p>
                  <p className="text-sm font-semibold text-white mt-0.5">{analysis.confidence}%</p>
                </div>
                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <p className="text-[11px] text-slate-500 uppercase tracking-wide">Status</p>
                  <p className="text-sm font-semibold text-green-500 mt-0.5">LIVE</p>
                </div>
              </div>
              <button className="mt-6 w-full py-5 rounded-2xl text-base font-bold transition-all duration-300 hover:-translate-y-0.5 active:scale-95" style={{background:'linear-gradient(135deg, #10B981, #059669)', color:'#FFFFFF', boxShadow:'0 10px 30px rgba(16,185,129,0.35)'}}>
                ⚡ MINT NOW
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}