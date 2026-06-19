'use client';
import React, { useState, useEffect } from 'react';
import { Zap, Plus, RefreshCw, XCircle, CheckCircle2, Clock, Play } from 'lucide-react';

export default function MintsPage() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('active');

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/mints');
      const data = await res.json();
      if (data.tasks) setTasks(data.tasks);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetchTasks(); }, []);

  const handleDelete = async (id: string) => {
    await fetch('/api/mints', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    fetchTasks();
  };
  const handleRetry = async (id: string) => {
    await fetch('/api/mints/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    fetchTasks();
  };

  const active = tasks.filter(t => t.status === 'running' || t.status === 'active' || t.status === 'pending');
  const upcoming = tasks.filter(t => t.status === 'monitoring' || t.status === 'scheduled');
  const completed = tasks.filter(t => t.status === 'completed');
  const failed = tasks.filter(t => t.status === 'failed' || t.status === 'dead_letter');

  const tabs = [
    { key: 'active', label: 'Active', count: active.length },
    { key: 'upcoming', label: 'Queued', count: upcoming.length },
    { key: 'completed', label: 'Completed', count: completed.length },
    { key: 'failed', label: 'Failed', count: failed.length },
  ];

  const currentTasks = activeTab === 'active' ? active : activeTab === 'upcoming' ? upcoming : activeTab === 'completed' ? completed : failed;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white mb-2">Mints</h1>
          <p className="text-white/60 text-sm">Track and manage mint executions</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-[#4F8CFF] text-white rounded-lg text-sm font-medium hover:bg-[#3D7AE8] transition-colors">
          <Plus className="w-4 h-4" />
          New Mint
        </button>
      </div>

      {loading ? (
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-8">
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-[#4F8CFF]/30 border-t-[#4F8CFF] animate-spin" />
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-xl bg-[#4F8CFF]/10 border border-[#4F8CFF]/20 flex items-center justify-center mb-4">
              <Zap className="w-8 h-8 text-[#4F8CFF]" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No mint tasks yet</h3>
            <p className="text-white/40 text-sm mb-6 max-w-sm text-center">Create your first mint execution from the dashboard</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-1 mb-6 border-b border-[rgba(255,255,255,0.06)]">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab.key
                    ? 'text-[#4F8CFF] border-[#4F8CFF]'
                    : 'text-white/40 border-transparent hover:text-white/60'
                }`}
              >
                {tab.label} <span className="text-white/40">({tab.count})</span>
              </button>
            ))}
          </div>

          <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg overflow-hidden">
            {currentTasks.length === 0 ? (
              <div className="p-12 text-center text-white/40">No {activeTab} mints</div>
            ) : (
              <div className="divide-y divide-[rgba(255,255,255,0.06)]">
                {currentTasks.map(t => (
                  <div key={t.id} className="px-4 py-3 hover:bg-white/5 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <p className="text-white font-medium text-sm">{t.collection?.name || 'Unknown'}</p>
                          <span className={`text-xs font-medium ${
                            t.status === 'completed' ? 'text-[#18C964]' : 
                            t.status === 'failed' ? 'text-[#F31260]' : 
                            t.status === 'running' ? 'text-[#4F8CFF]' : 
                            'text-white/40'
                          }`}>{t.status}</span>
                        </div>
                        <p className="text-white/40 text-xs">{t.wallet?.address ? `${t.wallet.address.slice(0,6)}...${t.wallet.address.slice(-4)}` : '—'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {activeTab === 'failed' && (
                          <button onClick={() => handleRetry(t.id)} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(t.id)} className="p-2 text-white/40 hover:text-[#F31260] hover:bg-[#F31260]/10 rounded-lg transition-colors">
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}