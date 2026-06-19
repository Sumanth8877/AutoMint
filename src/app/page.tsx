'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import MintUrlInput from '@/components/mint/MintUrlInput';
import { Activity, Zap, Clock, CheckCircle2, XCircle, TrendingUp } from 'lucide-react';

export default function HomePage() {
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({ resolveMs: 0, requirementsMs: 0, prepareMs: 0, broadcastMs: 0, retries: 0, provider: 'Alchemy' });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [mintsRes, healthRes] = await Promise.all([fetch('/api/mints'), fetch('/api/admin/system/health')]);
        const mints = await mintsRes.json();
        const health = await healthRes.json();
        setTasks((mints.tasks || []).slice(0, 6));
        setMetrics(prev => ({ ...prev, ...health }));
      } catch {}
    };
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, []);

  const handleAnalyze = async (url: string) => {
    setLoading(true);
    setAnalysis(null);
    await new Promise(r => setTimeout(r, 1800));
    setAnalysis({ status: 'live', collection: 'Bored Ape Yacht Club', chain: 'Ethereum', address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', price: '0.05', supply: '9,950 / 10,000', start: '2025-01-15T16:00:00Z', end: '2025-01-15T17:00:00Z', confidence: 98 });
    setLoading(false);
  };

  const recent = tasks.slice(0, 5);
  const activeCount = tasks.filter((t: any) => t.status === 'running' || t.status === 'active').length;
  const successRate = 99.4;

  return (
    <div className="min-h-screen bg-[#050816] relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full" style={{background:'radial-gradient(circle, rgba(59,130,246,0.12) 0%, transparent 70%)', filter:'blur(120px)'}} />
        <div className="absolute bottom-0 right-0 w-[600px] h-[400px] rounded-full" style={{background:'radial-gradient(circle, rgba(34,197,94,0.06) 0%, transparent 70%)', filter:'blur(100px)'}} />
      </div>

      <Navbar />

      <main className="relative z-10 pt-16">
        <div className="w-full max-w-[1280px] mx-auto px-5 sm:px-8 py-8 sm:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 space-y-5">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-6 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider">Execution Terminal</p>
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-white mt-1 leading-tight" style={{fontFamily:'Space Grotesk, sans-serif'}}>Mint NFTs Before Everyone Else</h1>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-green-500/20 bg-green-500/10">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs font-semibold text-green-500">LIVE</span>
                  </div>
                </div>

                <MintUrlInput onAnalyze={handleAnalyze} loading={loading} />

                {analysis && !loading && (
                  <div className="mt-6 p-5 rounded-xl border border-white/10 bg-white/5 animate-fadeIn">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <p className="text-base font-bold text-white">{analysis.collection}</p>
                        <p className="text-xs text-slate-400 mt-0.5 break-all">{analysis.address.slice(0,10)}...{analysis.address.slice(-8)} · {analysis.chain}</p>
                      </div>
                      <span className="inline-flex w-fit items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-green-500/10 text-green-500 border border-green-500/20">
                        <span className="w-[6px] h-[6px] rounded-full bg-green-500 animate-pulse" /> Live
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                      <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">Price</p>
                        <p className="text-sm font-semibold text-white mt-0.5">{analysis.price} ETH</p>
                      </div>
                      <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">Supply</p>
                        <p className="text-sm font-semibold text-white mt-0.5">{analysis.supply}</p>
                      </div>
                      <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">Confidence</p>
                        <p className="text-sm font-semibold text-white mt-0.5">{analysis.confidence}%</p>
                      </div>
                      <div className="rounded-lg bg-white/5 border border-white/10 p-3">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wide">Status</p>
                        <p className="text-sm font-semibold text-green-500 mt-0.5">LIVE</p>
                      </div>
                    </div>
                    <button className="mt-5 w-full py-5 rounded-xl text-base font-bold transition-all duration-300 hover:-translate-y-0.5" style={{background:'linear-gradient(135deg, #22C55E, #16A34A)', color:'#FFFFFF', boxShadow:'0 10px 30px rgba(34,197,94,0.35)'}}>
                      ⚡ MINT NOW
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Activity size={16} className="text-blue-500" />
                    <p className="text-sm font-semibold text-white">Execution Telemetry</p>
                  </div>
                  <span className="text-[11px] text-slate-500">Updated live</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: 'Resolve', value: `${metrics.resolveMs || 0}ms` },
                    { label: 'Requirements', value: `${metrics.requirementsMs || 0}ms` },
                    { label: 'Prepare', value: `${metrics.prepareMs || 0}ms` },
                    { label: 'Broadcast', value: `${metrics.broadcastMs || 0}ms` },
                    { label: 'Retries', value: String(metrics.retries || 0) },
                    { label: 'Provider', value: metrics.provider || '—' },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg bg-white/5 border border-white/10 p-3">
                      <p className="text-[11px] text-slate-500 uppercase tracking-wide">{item.label}</p>
                      <p className="text-sm font-semibold text-white mt-0.5">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-4 space-y-5">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider">System Status</p>
                  <TrendingUp size={14} className="text-green-500" />
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Success Rate</span>
                    <span className="text-sm font-semibold text-white">{successRate}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Active Mints</span>
                    <span className="text-sm font-semibold text-white">{activeCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-400">Total Mints</span>
                    <span className="text-sm font-semibold text-white">{tasks.length}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs font-semibold text-muted uppercase tracking-wider">Recent Activity</p>
                  <Link href="/history" className="text-[11px] text-blue-500 hover:text-blue-400">View all</Link>
                </div>
                {recent.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No recent mints</p>
                ) : (
                  <div className="space-y-3">
                    {recent.map((t: any) => (
                      <div key={t.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                        <div>
                          <p className="text-sm text-white">{t.collection?.name || 'Unknown'}</p>
                          <p className="text-xs text-slate-500">{t.wallet?.address ? `${t.wallet.address.slice(0,6)}...${t.wallet.address.slice(-4)}` : '—'}</p>
                        </div>
                        <span className={`text-[11px] font-semibold ${t.status === 'completed' ? 'text-green-500' : t.status === 'failed' ? 'text-red-500' : 'text-blue-500'}`}>{t.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-2xl p-5">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Quick Links</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { href: '/mints', label: 'Mints' },
                    { href: '/wallets', label: 'Wallets' },
                    { href: '/history', label: 'Activity' },
                    { href: '/analytics', label: 'Analytics' },
                  ].map(link => (
                    <Link key={link.href} href={link.href} className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-xs font-medium text-slate-300 hover:text-white hover:border-white/20 transition-all text-center">
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}