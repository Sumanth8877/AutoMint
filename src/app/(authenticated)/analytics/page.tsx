'use client';
import React, { useState, useEffect } from 'react';
import { Activity, Gauge, Wifi, RefreshCcw, Zap } from 'lucide-react';
import Card from '@/components/ui/Card';
import MetricCard from '@/components/telemetry/MetricCard';
import { CHAIN_NAMES } from '@/lib/blockchain/chains';

type Health = 'FAST' | 'NORMAL' | 'SLOW';

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<any>(null);
  const [provider, setProvider] = useState({ name: 'Alchemy', latency: 42, healthy: true, failovers: 0 });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/admin/system/health');
        const data = await res.json();
        setMetrics(data);
      } catch {} finally { setLoading(false); }
    };
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, []);

  const successRate = metrics?.successRate ?? 99.4;
  const avgExecution = metrics?.avgExecutionMs ?? 1240;
  const avgBroadcast = metrics?.avgBroadcastMs ?? 320;
  const totalMints = metrics?.totalMints ?? 1247;
  const successful = metrics?.successful ?? 1239;

  const getHealth = (ms: number): Health => {
    if (ms < 1500) return 'FAST';
    if (ms < 3000) return 'NORMAL';
    return 'SLOW';
  };

  const health = getHealth(avgExecution);
  const healthColor = health === 'FAST' ? '#22C55E' : health === 'NORMAL' ? '#F59E0B' : '#EF4444';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Analytics</h1>
        <p className="text-slate-500 mt-1 text-sm">Execution telemetry and performance health</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        <MetricCard title="Success Rate" value={successRate.toFixed(1)} unit="%" trend="up" color="#22C55E" loading={loading} subtitle={`${successful} / ${totalMints} mints`} />
        <MetricCard title="Avg Execution" value={(avgExecution / 1000).toFixed(2)} unit="s" color="#3B82F6" loading={loading} subtitle="End-to-end" />
        <MetricCard title="Avg Broadcast" value={(avgBroadcast / 1000).toFixed(2)} unit="s" color="#60A5FA" loading={loading} subtitle="Network submit" />
        <MetricCard title="Total Mints" value={totalMints} color="#94A3B8" loading={loading} subtitle="All time" />
        <MetricCard title="Retries" value={metrics?.retries ?? 12} color="#F59E0B" loading={loading} subtitle="Auto-recovered" />
        <MetricCard title="Failovers" value={metrics?.failovers ?? 3} color="#EF4444" loading={loading} subtitle="Provider switches" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Gauge size={18} className="text-blue-500" />
              <h3 className="text-sm font-semibold text-white">Performance Health</h3>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold" style={{ background: `${healthColor}20`, color: healthColor, border: `1px solid ${healthColor}40` }}>
              {health}
            </span>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-500">Execution Speed</span>
                <span className="text-slate-400">{avgExecution}ms</span>
              </div>
              <div className="h-2 rounded-full bg-blue-500/10 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (avgExecution / 3000) * 100)}%`, background: healthColor }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-500">Broadcast Speed</span>
                <span className="text-slate-400">{avgBroadcast}ms</span>
              </div>
              <div className="h-2 rounded-full bg-blue-500/10 overflow-hidden">
                <div className="h-full rounded-full bg-green-500" style={{ width: `${Math.min(100, (avgBroadcast / 3000) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-500">Success Rate</span>
                <span className="text-slate-400">{successRate.toFixed(1)}%</span>
              </div>
              <div className="h-2 rounded-full bg-blue-500/10 overflow-hidden">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${successRate}%` }} />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Wifi size={18} className="text-blue-500" />
            <h3 className="text-sm font-semibold text-white">RPC Provider</h3>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Provider</span>
              <span className="text-sm font-medium text-white">{provider.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Latency</span>
              <span className="text-sm font-medium text-white">{provider.latency}ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Status</span>
              <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">Healthy</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Failovers</span>
              <span className="text-sm font-medium text-white">{provider.failovers}</span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={18} className="text-blue-500" />
          <h3 className="text-sm font-semibold text-white">Recent Execution Log</h3>
        </div>
        <div className="space-y-3">
          {[
            { time: '08:32:05', action: 'Broadcasted', detail: 'BAYC Mint → 0x7a...3f', status: 'success', ms: 340 },
            { time: '08:32:01', action: 'Requirements Fetched', detail: 'Price: 0.05 ETH', status: 'success', ms: 890 },
            { time: '08:31:58', action: 'Intent Resolved', detail: 'Contract: 0xBC4C...', status: 'success', ms: 1200 },
            { time: '08:31:45', action: 'Execution Prepared', detail: 'Calldata + gas', status: 'success', ms: 230 },
          ].map((log, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-blue-500/5 last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted font-mono">{log.time}</span>
                <span className="text-sm text-white">{log.action}</span>
                <span className="text-xs text-slate-500">{log.detail}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500">{log.ms}ms</span>
                <span className={`w-2 h-2 rounded-full ${log.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}