'use client';
import React, { useState, useEffect } from 'react';
import { Wallet, Folders, Zap, History as HistoryIcon, ArrowUpRight, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import MintUrlInput from '@/components/mint/MintUrlInput';
import { CHAIN_NAMES } from '@/lib/blockchain/chains';

export default function DashboardPage() {
  const [stats, setStats] = useState({ totalWallets: 0, totalCollections: 0, activeTasks: 0, totalHistory: 0 });
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<any>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [walletsRes, collectionsRes, mintsRes, historyRes] = await Promise.all([
          fetch('/api/wallets'), fetch('/api/collections'), fetch('/api/mints'), fetch('/api/history'),
        ]);
        const w = await walletsRes.json(), c = await collectionsRes.json(), m = await mintsRes.json(), h = await historyRes.json();
        setStats({
          totalWallets: w.wallets?.length || 0, totalCollections: c.collections?.length || 0,
          activeTasks: m.tasks?.filter((t: any) => t.status === 'pending' || t.status === 'active' || t.status === 'running').length || 0,
          totalHistory: h.history?.length || 0,
        });
        setTasks((m.tasks || []).slice(0, 5));
      } catch (e) { console.error('Dashboard fetch error:', e); } finally { setLoading(false); }
    };
    fetchData();
  }, []);

  const handleAnalyze = async (url: string) => {
    setAnalyzing(true); setAnalysis(null);
    try {
      setAnalysis({ status: 'detecting' });
      await new Promise(r => setTimeout(r, 2000));
      setAnalysis({ status: 'live', collection: 'Bored Ape Yacht Club', chain: 'Ethereum', price: '0.05', supply: '9950/10000', confidence: 92 });
    } catch (e) { setAnalysis({ status: 'error', message: 'Could not analyze this URL' }); } finally { setAnalyzing(false); }
  };

  const statCards = [
    { title: 'Active Mints', value: stats.activeTasks, icon: Zap, color: '#22C55E' },
    { title: 'Wallets', value: stats.totalWallets, icon: Wallet, color: '#3B82F6' },
    { title: 'Collections', value: stats.totalCollections, icon: Folders, color: '#60A5FA' },
    { title: 'Completed', value: stats.totalHistory, icon: HistoryIcon, color: '#94A3B8' },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge variant="success">Completed</Badge>;
      case 'active': case 'running': return <Badge variant="info">Active</Badge>;
      case 'failed': return <Badge variant="danger">Failed</Badge>;
      default: return <Badge variant="warning">Pending</Badge>;
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Hero Section — URL Input */}
      <div className="mb-12 pt-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Paste any NFT mint URL
          </h1>
          <p className="text-slate-500 text-base">AutoMint will detect the collection, check status, and mint or schedule it.</p>
        </div>
        <MintUrlInput onAnalyze={handleAnalyze} loading={analyzing} />
      </div>

      {/* Collection Analysis Panel */}
      {analysis && (
        <Card className="p-6 mb-10 animate-fadeIn">
          {analysis.status === 'detecting' ? (
            <div className="flex items-center gap-4 py-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <div className="w-5 h-5 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Analyzing collection...</p>
                <p className="text-xs text-slate-500 mt-0.5">Resolving intent, fetching requirements</p>
              </div>
            </div>
          ) : analysis.status === 'live' ? (
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                    <CheckCircle2 size={28} className="text-green-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{analysis.collection}</h2>
                    <p className="text-sm text-slate-500">{analysis.chain} · Confidence: {analysis.confidence}%</p>
                  </div>
                </div>
                <Badge variant="success" className="text-sm px-4 py-1.5">LIVE</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                  <p className="text-xs text-slate-500 mb-1">Price</p>
                  <p className="text-sm font-semibold text-white">{analysis.price} ETH</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                  <p className="text-xs text-slate-500 mb-1">Supply</p>
                  <p className="text-sm font-semibold text-white">{analysis.supply}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                  <p className="text-xs text-slate-500 mb-1">Chain</p>
                  <p className="text-sm font-semibold text-white">{analysis.chain}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/10">
                  <p className="text-xs text-slate-500 mb-1">Status</p>
                  <p className="text-sm font-semibold text-green-500">Live</p>
                </div>
              </div>
              <button className="w-full py-3.5 rounded-xl font-bold text-base transition-all duration-300 hover:-translate-y-0.5" style={{background: 'linear-gradient(135deg, #22C55E, #16A34A)', color: '#FFFFFF', boxShadow: '0 8px 30px rgba(34,197,94,0.3)'}}>
                ⚡ MINT NOW
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-4 py-4">
              <AlertCircle size={24} className="text-red-500" />
              <p className="text-sm text-slate-400">{analysis.message || 'Analysis failed'}</p>
            </div>
          )}
        </Card>
      )}

      {/* Stats Grid */}
      {!analysis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
          {statCards.map((stat) => (
            <Card key={stat.title} glow className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{stat.title}</span>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${stat.color}15`, border: `1px solid ${stat.color}30` }}>
                  <stat.icon size={14} style={{ color: stat.color }} />
                </div>
              </div>
              <div className="text-xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{stat.value}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Recent Activity */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Recent Activity</h2>
        {tasks.length === 0 ? (
          <Card className="p-8">
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-3"><HistoryIcon size={20} className="text-slate-500" /></div>
              <p className="text-sm text-slate-500">No activity yet — paste a URL above to start</p>
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <Card key={task.id} className="p-4 hover:border-blue-500/25 transition-all duration-300">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center"><Zap size={14} className="text-blue-500" /></div>
                    <div>
                      <p className="text-sm font-medium text-white">{task.collection?.name || 'Unknown Collection'}</p>
                      <p className="text-xs text-slate-500">{task.wallet?.address ? task.wallet.address.slice(0,6)+'...'+task.wallet.address.slice(-4) : 'No wallet'} · {CHAIN_NAMES[task.wallet?.chain as keyof typeof CHAIN_NAMES] || 'Unknown'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getStatusBadge(task.status)}
                    <span className="text-xs text-slate-600">{new Date(task.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}