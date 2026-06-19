'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { Search, Bell, Settings, User } from 'lucide-react';

export default function HomePage() {
  const [url, setUrl] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);

  const handleAnalyze = async () => {
    if (!url) return;
    setAnalyzing(true);
    setAnalysis(null);
    await new Promise(r => setTimeout(r, 2000));
    setAnalysis({
      status: 'live',
      collection: 'Bored Ape Yacht Club',
      chain: 'Ethereum',
      address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
      price: '0.05',
      supply: '9,950 / 10,000',
      riskScore: 'Low',
      gasEstimate: '0.008',
      verified: true
    });
    setAnalyzing(false);
  };

  return (
    <div className="min-h-screen bg-[#05070A]">
      {/* Navigation */}
      <nav className="border-b border-[rgba(255,255,255,0.06)] bg-[#05070A]">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-white font-semibold text-lg">
              AutoMint
            </Link>
          </div>
          
          <div className="flex-1 max-w-xl mx-8">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="text"
                placeholder="Search..."
                className="w-full bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#4F8CFF] transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="p-2 text-white/60 hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
            </button>
            <Link href="/settings" className="p-2 text-white/60 hover:text-white transition-colors">
              <Settings className="w-5 h-5" />
            </Link>
            <Link href="/dashboard" className="p-2 text-white/60 hover:text-white transition-colors">
              <User className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-semibold text-white mb-4">
            Execution Terminal
          </h1>
          <p className="text-white/60 text-lg">
            Paste NFT mint URL to begin analysis
          </p>
        </div>

        {/* URL Input */}
        <div className="mb-8">
          <div className="flex gap-4">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://magiceden.io/launchpad/collection"
              className="flex-1 bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-3 text-white placeholder:text-white/40 focus:outline-none focus:border-[#4F8CFF] transition-colors"
            />
            <button
              onClick={handleAnalyze}
              disabled={!url || analyzing}
              className="px-6 py-3 bg-[#4F8CFF] text-white rounded-lg font-medium hover:bg-[#3D7AE8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {analyzing ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>
        </div>

        {/* Analysis Panel */}
        {analyzing && (
          <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-6">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-[#4F8CFF] border-t-transparent rounded-full animate-spin" />
              <span className="text-white/60">Analyzing collection...</span>
            </div>
          </div>
        )}

        {analysis && !analyzing && (
          <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-6 animate-slideUp">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-white">{analysis.collection}</h2>
                <p className="text-white/60 text-sm mt-1">
                  {analysis.address.slice(0, 10)}...{analysis.address.slice(-8)} · {analysis.chain}
                </p>
              </div>
              <span className="px-3 py-1 bg-[#18C964]/10 text-[#18C964] text-xs font-medium rounded-full">
                {analysis.status}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Price</p>
                <p className="text-white font-medium">{analysis.price} ETH</p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Supply</p>
                <p className="text-white font-medium">{analysis.supply}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Risk Score</p>
                <p className="text-[#18C964] font-medium">{analysis.riskScore}</p>
              </div>
              <div>
                <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Gas Est.</p>
                <p className="text-white font-medium">{analysis.gasEstimate} ETH</p>
              </div>
            </div>

            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${analysis.verified ? 'bg-[#18C964]' : 'bg-[#F31260]'}`} />
                <span className="text-white/60 text-sm">
                  {analysis.verified ? 'Contract Verified' : 'Contract Unverified'}
                </span>
              </div>
            </div>

            <button className="w-full py-4 bg-[#4F8CFF] text-white rounded-lg font-medium hover:bg-[#3D7AE8] transition-colors">
              MINT NOW
            </button>
          </div>
        )}
      </main>
    </div>
  );
}