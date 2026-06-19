'use client';

import React, { useState, useEffect } from 'react';
import { History, ExternalLink, CheckCircle, XCircle, Clock } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';

interface HistoryEntry {
  id: string;
  walletId: string | null;
  collectionId: string | null;
  status: string;
  transactionHash: string | null;
  createdAt: string;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHistory = async () => {
    const res = await fetch('/api/history');
    const data = await res.json();
    if (data.history) setHistory(data.history);
    setLoading(false);
  };

  useEffect(() => { fetchHistory(); }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'confirmed': return <Badge variant="success">Confirmed</Badge>;
      case 'failed': return <Badge variant="danger">Failed</Badge>;
      default: return <Badge variant="warning">Pending</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'confirmed': return <CheckCircle size={14} className="text-success" />;
      case 'failed': return <XCircle size={14} className="text-danger" />;
      default: return <Clock size={14} className="text-warning" />;
    }
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Mint History</h1>
        <p className="text-muted mt-1">Track your minting activity</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="loader" /></div>
      ) : history.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
              <History size={28} className="text-muted" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No activity yet</h3>
            <p className="text-muted text-sm text-center max-w-sm">Mint history will appear here once you start minting.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {history.map((entry) => (
            <Card key={entry.id} className="p-4 hover:border-blue-500/25 transition-all duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(entry.status)}
                  <div>
                    <p className="text-sm font-medium text-white">Mint #{entry.id.slice(0, 8)}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(entry.status)}
                  {entry.transactionHash && (
                    <a
                      href={`https://etherscan.io/tx/${entry.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:text-blue-400"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}