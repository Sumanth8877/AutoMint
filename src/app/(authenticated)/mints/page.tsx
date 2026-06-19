'use client';
import React, { useState, useEffect } from 'react';
import { Zap, ArrowUpRight } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { ActiveMintCard, UpcomingMintCard, CompletedMintCard, FailedMintCard } from '@/components/mint/MintCard';

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
    { key: 'active', label: 'Active', count: active.length, color: '#22C55E' },
    { key: 'upcoming', label: 'Upcoming', count: upcoming.length, color: '#3B82F6' },
    { key: 'completed', label: 'Completed', count: completed.length, color: '#94A3B8' },
    { key: 'failed', label: 'Failed', count: failed.length, color: '#EF4444' },
  ];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Mints</h1>
          <p className="text-slate-500 mt-1 text-sm">Track and manage all your mint tasks</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-6 h-6 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" /></div>
      ) : tasks.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4"><Zap size={28} className="text-blue-500" /></div>
            <h3 className="text-lg font-semibold text-white mb-2">No mint tasks yet</h3>
            <p className="text-slate-500 text-sm mb-6 max-w-sm text-center">Paste a mint URL on the Dashboard to create your first AutoMint.</p>
            <a href="/dashboard"><Button variant="primary"><ArrowUpRight size={16} /> Go to Dashboard</Button></a>
          </div>
        </Card>
      ) : (
        <>
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                  activeTab === tab.key ? 'bg-blue-500/10 border border-blue-500/20 text-white' : 'text-slate-500 hover:text-white hover:bg-white/5'
                }`}>
                {tab.label} <span className="text-xs" style={{color: tab.color}}>({tab.count})</span>
              </button>
            ))}
          </div>

          <div className="space-y-3 animate-fadeIn">
            {activeTab === 'active' && active.map(t => <ActiveMintCard key={t.id} task={t} onDelete={handleDelete} />)}
            {activeTab === 'upcoming' && upcoming.map(t => <UpcomingMintCard key={t.id} task={t} onDelete={handleDelete} />)}
            {activeTab === 'completed' && completed.map(t => <CompletedMintCard key={t.id} task={t} />)}
            {activeTab === 'failed' && failed.map(t => <FailedMintCard key={t.id} task={t} onDelete={handleDelete} onRetry={handleRetry} />)}
          </div>
        </>
      )}
    </div>
  );
}