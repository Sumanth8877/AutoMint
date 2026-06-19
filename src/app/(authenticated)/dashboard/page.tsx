'use client';
import React, { useState, useEffect } from 'react';
import { Zap, Clock, CheckCircle2, XCircle, Activity } from 'lucide-react';
import Card from '@/components/ui/Card';
import MintUrlInput from '@/components/mint/MintUrlInput';

export default function DashboardPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({ resolveMs: 0, requirementsMs: 0, prepareMs: 0, broadcastMs: 0, retries: 0, provider: 'Alchemy' });
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [mintsRes, healthRes] = await Promise.all([fetch('/api/mints'), fetch('/api/admin/system/health')]);
        const mints = await mintsRes.json();
        const health = await healthRes.json();
        setTasks((mints.tasks || []).slice(0, 8));
        setMetrics(prev => ({ ...prev, ...health }));
      } catch {} finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const handleAnalyze = async (url: string) => {
    setAnalyzing(true);
    setAnalysis(null);
    await new Promise(r => setTimeout(r, 1800));
    setAnalysis({ status: 'live', collection: 'Bored Ape Yacht Club', chain: 'Ethereum', address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', price: '0.05', supply: '9,950 / 10,000', confidence: 98 });
    setAnalyzing(false);
  };

  const active = tasks.filter((t: any) => t.status === 'running' || t.status === 'active' || t.status === 'pending');
  const upcoming = tasks.filter((t: any) => t.status === 'monitoring' || t.status === 'scheduled');
  const completed = tasks.filter((t: any) => t.status === 'completed');
  const failed = tasks.filter((t: any) => t.status === 'failed' || t.status === 'dead_letter');

  return (
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Dashboard</h1>
        <p className="text-slate-500 mt-1 text-sm">Execute mints. Monitor activity. Review telemetry.</p>
      </div>

      <Card className="p-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <p className="text-sm font-medium text-white">Quick Mint</p>
            <p className="text-xs text-slate-500 mt-0.5">Paste a URL to analyze and mint instantly.</p>
          </div>
        </div>
        <MintUrlInput onAnalyze={handleAnalyze} loading={analyzing} />
        {analysis && !analyzing && (
          <div className="mt-4 p-4 rounded-xl border border-white/10 bg-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fadeIn">
            <div>
              <p className="text-white font-semibold">{analysis.collection}</p>
              <p className="text-xs text-slate-400 mt-0.5 break-all">{analysis.address.slice(0,10)}...{analysis.address.slice(-8)} · {analysis.chain}</p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-wide bg-green-500/10 text-green-500 border border-green-500/20">
              <span className="w-[6px] h-[6px] rounded-full bg-green-500 animate-pulse" /> Live
            </span>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted uppercase tracking-wider">Active Mints</p>
            <Zap size={16} className="text-green-500" />
          </div>
          <p className="text-xl font-bold text-white mt-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{active.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted uppercase tracking-wider">Upcoming</p>
            <Clock size={16} className="text-blue-500" />
          </div>
          <p className="text-xl font-bold text-white mt-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{upcoming.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted uppercase tracking-wider">Completed</p>
            <CheckCircle2 size={16} className="text-green-500" />
          </div>
          <p className="text-xl font-bold text-white mt-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{completed.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted uppercase tracking-wider">Failed</p>
            <XCircle size={16} className="text-red-500" />
          </div>
          <p className="text-xl font-bold text-white mt-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{failed.length}</p>
        </Card>
      </div>

      <Card className="p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={18} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-white">Execution Telemetry</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">Resolve</p>
            <p className="text-sm font-semibold text-white mt-0.5">{metrics.resolveMs || 0}ms</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">Requirements</p>
            <p className="text-sm font-semibold text-white mt-0.5">{metrics.requirementsMs || 0}ms</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">Prepare</p>
            <p className="text-sm font-semibold text-white mt-0.5">{metrics.prepareMs || 0}ms</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">Broadcast</p>
            <p className="text-sm font-semibold text-white mt-0.5">{metrics.broadcastMs || 0}ms</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">Retries</p>
            <p className="text-sm font-semibold text-white mt-0.5">{metrics.retries || 0}</p>
          </div>
          <div>
            <p className="text-[11px] text-slate-500 uppercase tracking-wide">Provider</p>
            <p className="text-sm font-semibold text-white mt-0.5">{metrics.provider || '—'}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Recent Mints</h3>
        </div>
        {loading ? (
          <div className="py-10 flex justify-center"><div className="w-5 h-5 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" /></div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-10">No mints yet. Use the quick mint input above to get started.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <div>
                  <p className="text-sm text-white">{t.collection?.name || 'Unknown'}</p>
                  <p className="text-xs text-slate-500">{t.wallet?.address ? `${t.wallet.address.slice(0,6)}...${t.wallet.address.slice(-4)}` : '—'}</p>
                </div>
                <span className={`text-xs font-medium ${t.status === 'completed' ? 'text-green-500' : t.status === 'failed' ? 'text-red-500' : 'text-blue-500'}`}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}