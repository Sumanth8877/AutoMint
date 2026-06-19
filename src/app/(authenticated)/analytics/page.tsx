'use client';

import React, { useState, useEffect } from 'react';
import { Activity, Shield, Zap, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import Card from '@/components/ui/Card';
import Loader from '@/components/ui/Loader';

interface SystemHealth {
  api: 'healthy' | 'warning' | 'offline';
  database: 'healthy' | 'warning' | 'offline';
  rpc: 'healthy' | 'warning' | 'offline';
  lastError: string | null;
  avgResponseTime: number;
}

interface PageView {
  page: string;
  views: number;
}

interface ErrorLog {
  id: string;
  type: 'frontend' | 'api' | 'blockchain';
  message: string;
  page: string;
  timestamp: string;
  severity: 'low' | 'medium' | 'high';
  resolved: boolean;
}

export default function AnalyticsPage() {
  const [health, setHealth] = useState<SystemHealth>({
    api: 'healthy',
    database: 'healthy',
    rpc: 'healthy',
    lastError: null,
    avgResponseTime: 120,
  });
  const [pageViews, setPageViews] = useState<PageView[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // In production, these would be fetched from monitoring APIs
    // For now, showing placeholder structure
    setLoading(false);
  }, []);

  const healthCards = [
    { label: 'API Status', value: health.api, icon: Zap, color: health.api === 'healthy' ? '#3B82F6' : health.api === 'warning' ? '#F59E0B' : '#EF4444' },
    { label: 'Database', value: health.database, icon: Activity, color: health.database === 'healthy' ? '#3B82F6' : health.database === 'warning' ? '#F59E0B' : '#EF4444' },
    { label: 'RPC Status', value: health.rpc, icon: Shield, color: health.rpc === 'healthy' ? '#3B82F6' : health.rpc === 'warning' ? '#F59E0B' : '#EF4444' },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-success';
      case 'warning': return 'text-warning';
      case 'offline': return 'text-danger';
      default: return 'text-muted';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'text-danger';
      case 'medium': return 'text-warning';
      case 'low': return 'text-slate-400';
      default: return 'text-muted';
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Analytics & Monitoring</h1>
        <p className="text-muted mt-1">System health and user behavior insights</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader /></div>
      ) : (
        <>
          {/* System Health */}
          <div className="mb-10">
            <h2 className="text-lg font-semibold text-white mb-4" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>System Health</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {healthCards.map((card) => (
                <Card key={card.label} glow className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{card.label}</span>
                    <card.icon size={16} style={{ color: card.color }} />
                  </div>
                  <div className={`text-sm font-semibold capitalize ${getStatusColor(card.value)}`}>{card.value}</div>
                </Card>
              ))}
            </div>
          </div>

          {/* Stats Overview */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Users size={18} className="text-blue-500" />
                <h3 className="text-sm font-semibold text-white">Page Views</h3>
              </div>
              {pageViews.length === 0 ? (
                <p className="text-xs text-slate-500">No data available yet</p>
              ) : (
                <div className="space-y-2">
                  {pageViews.map((view) => (
                    <div key={view.page} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{view.page}</span>
                      <span className="text-white font-medium">{view.views} views</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp size={18} className="text-blue-500" />
                <h3 className="text-sm font-semibold text-white">Session Info</h3>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Avg. Duration</span>
                  <span className="text-white">4m 32s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Bounce Rate</span>
                  <span className="text-white">32%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Active Users</span>
                  <span className="text-white">--</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Recent Errors */}
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-warning" />
              <h3 className="text-sm font-semibold text-white">Recent Errors</h3>
            </div>
            {errors.length === 0 ? (
              <p className="text-xs text-slate-500">No errors reported</p>
            ) : (
              <div className="space-y-3">
                {errors.map((error) => (
                  <div key={error.id} className="p-3 rounded-xl bg-[#0B1120] border border-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-white">{error.message}</span>
                      <span className={`text-xs ${getSeverityColor(error.severity)}`}>{error.severity}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{error.page}</span>
                      <span>{new Date(error.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}