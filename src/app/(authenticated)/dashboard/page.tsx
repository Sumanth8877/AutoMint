'use client';
import React, { useState, useEffect } from 'react';
import { Activity, Zap, Clock, CheckCircle2, XCircle, TrendingUp, Plus } from 'lucide-react';

export default function DashboardPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({ resolveMs: 0, requirementsMs: 0, prepareMs: 0, broadcastMs: 0, retries: 0, provider: 'Alchemy' });
  const [loading, setLoading] = useState(true);

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

  const active = tasks.filter((t: any) => t.status === 'running' || t.status === 'active' || t.status === 'pending');
  const upcoming = tasks.filter((t: any) => t.status === 'monitoring' || t.status === 'scheduled');
  const completed = tasks.filter((t: any) => t.status === 'completed');
  const failed = tasks.filter((t: any) => t.status === 'failed' || t.status === 'dead_letter');

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-2">Dashboard</h1>
        <p className="text-white/60 text-sm">Monitor execution activity and system health</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-[#4F8CFF]" />
            <p className="text-white/40 text-xs uppercase tracking-wide">Active</p>
          </div>
          <p className="text-2xl font-semibold text-white">{active.length}</p>
        </div>
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-[#F5A524]" />
            <p className="text-white/40 text-xs uppercase tracking-wide">Upcoming</p>
          </div>
          <p className="text-2xl font-semibold text-white">{upcoming.length}</p>
        </div>
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-[#18C964]" />
            <p className="text-white/40 text-xs uppercase tracking-wide">Completed</p>
          </div>
          <p className="text-2xl font-semibold text-white">{completed.length}</p>
        </div>
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="w-4 h-4 text-[#F31260]" />
            <p className="text-white/40 text-xs uppercase tracking-wide">Failed</p>
          </div>
          <p className="text-2xl font-semibold text-white">{failed.length}</p>
        </div>
      </div>

      {/* System Health */}
      <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-white/60" />
          <h3 className="text-sm font-semibold text-white">System Health</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Resolve</p>
            <p className="text-sm font-medium text-white">{metrics.resolveMs || 0}ms</p>
          </div>
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Requirements</p>
            <p className="text-sm font-medium text-white">{metrics.requirementsMs || 0}ms</p>
          </div>
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Prepare</p>
            <p className="text-sm font-medium text-white">{metrics.prepareMs || 0}ms</p>
          </div>
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Broadcast</p>
            <p className="text-sm font-medium text-white">{metrics.broadcastMs || 0}ms</p>
          </div>
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Retries</p>
            <p className="text-sm font-medium text-white">{metrics.retries || 0}</p>
          </div>
          <div>
            <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Provider</p>
            <p className="text-sm font-medium text-white">{metrics.provider || '—'}</p>
          </div>
        </div>
      </div>

      {/* Recent Mints */}
      <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Recent Executions</h3>
          <button className="flex items-center gap-2 text-sm text-[#4F8CFF] hover:text-[#3D7AE8] transition-colors">
            <Plus className="w-4 h-4" />
            New Mint
          </button>
        </div>
        {loading ? (
          <div className="py-10 flex justify-center">
            <div className="w-5 h-5 rounded-full border-2 border-[#4F8CFF]/30 border-t-[#4F8CFF] animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-white/40 text-center py-10">No executions yet</p>
        ) : (
          <div className="space-y-1">
            {tasks.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between py-3 px-3 hover:bg-white/5 rounded-lg transition-colors">
                <div>
                  <p className="text-sm text-white">{t.collection?.name || 'Unknown'}</p>
                  <p className="text-xs text-white/40">{t.wallet?.address ? `${t.wallet.address.slice(0,6)}...${t.wallet.address.slice(-4)}` : '—'}</p>
                </div>
                <span className={`text-xs font-medium ${
                  t.status === 'completed' ? 'text-[#18C964]' : 
                  t.status === 'failed' ? 'text-[#F31260]' : 
                  'text-[#4F8CFF]'
                }`}>{t.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}