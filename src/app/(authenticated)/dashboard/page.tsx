'use client';

import React, { useState, useEffect } from 'react';
import { Wallet, Folders, Zap, History as HistoryIcon } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { CHAIN_NAMES } from '@/lib/blockchain/chains';

interface StatData {
  totalWallets: number;
  totalCollections: number;
  activeTasks: number;
  totalHistory: number;
}

interface MintTask {
  id: string;
  status: string;
  createdAt: string;
  wallet: { address: string; chain: string } | null;
  collection: { name: string } | null;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatData>({ totalWallets: 0, totalCollections: 0, activeTasks: 0, totalHistory: 0 });
  const [tasks, setTasks] = useState<MintTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [walletsRes, collectionsRes, mintsRes, historyRes] = await Promise.all([
          fetch('/api/wallets'),
          fetch('/api/collections'),
          fetch('/api/mints'),
          fetch('/api/history'),
        ]);

        const walletsData = await walletsRes.json();
        const collectionsData = await collectionsRes.json();
        const mintsData = await mintsRes.json();
        const historyData = await historyRes.json();

        setStats({
          totalWallets: walletsData.wallets?.length || 0,
          totalCollections: collectionsData.collections?.length || 0,
          activeTasks: mintsData.tasks?.filter((t: any) => t.status === 'pending' || t.status === 'active').length || 0,
          totalHistory: historyData.history?.length || 0,
        });

        setTasks((mintsData.tasks || []).slice(0, 5));
      } catch (error) {
        console.error('Dashboard fetch error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const statCards = [
    { title: 'Total Wallets', value: stats.totalWallets, icon: Wallet, color: '#3B82F6' },
    { title: 'Collections', value: stats.totalCollections, icon: Folders, color: '#60A5FA' },
    { title: 'Active Tasks', value: stats.activeTasks, icon: Zap, color: '#F59E0B' },
    { title: 'Mint History', value: stats.totalHistory, icon: HistoryIcon, color: '#94A3B8' },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return <Badge variant="success">Completed</Badge>;
      case 'active': return <Badge variant="info">Active</Badge>;
      case 'failed': return <Badge variant="danger">Failed</Badge>;
      default: return <Badge variant="warning">Pending</Badge>;
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Dashboard</h1>
        <p className="text-muted mt-1">Welcome back. Here's your overview.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="loader" /></div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {statCards.map((stat) => (
              <Card key={stat.title} glow className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{stat.title}</span>
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: `${stat.color}15`, border: `1px solid ${stat.color}30` }}
                  >
                    <stat.icon size={16} style={{ color: stat.color }} />
                  </div>
                </div>
                <div className="text-2xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{stat.value}</div>
              </Card>
            ))}
          </div>

          {/* Recent Activity */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-4" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Recent Activity</h2>
            {tasks.length === 0 ? (
              <Card className="p-8">
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-3">
                    <HistoryIcon size={20} className="text-muted" />
                  </div>
                  <p className="text-sm text-slate-500">No activity yet</p>
                </div>
              </Card>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => (
                  <Card key={task.id} className="p-4 hover:border-blue-500/25 transition-all duration-300">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                          <Zap size={14} className="text-blue-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-white">
                            {task.collection?.name || 'Unknown Collection'}
                          </p>
                          <p className="text-xs text-slate-500">
                            {task.wallet?.address ? `${task.wallet.address.slice(0, 6)}...${task.wallet.address.slice(-4)}` : 'No wallet'} · {CHAIN_NAMES[task.wallet?.chain as keyof typeof CHAIN_NAMES] || 'Unknown'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {getStatusBadge(task.status)}
                        <span className="text-xs text-slate-600">
                          {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}