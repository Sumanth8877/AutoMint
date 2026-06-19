'use client';
import React, { useState, useEffect } from 'react';
import { Wallet as WalletIcon, ArrowUpRight, Copy, Trash2, RefreshCw } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import WalletCard, { WalletData } from '@/components/wallets/WalletCard';

export default function WalletsPage() {
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchWallets = async () => {
    try {
      const res = await fetch('/api/wallets');
      const data = await res.json();
      if (data.wallets) setWallets(data.wallets);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { fetchWallets(); }, []);

  const handleCopy = async (address: string) => {
    await navigator.clipboard.writeText(address);
  };
  const handleRemove = async (id: string) => {
    await fetch('/api/wallets', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    fetchWallets();
  };
  const handleRefresh = async (id: string) => {
    await fetch(`/api/wallets/${id}/balance`, { method: 'POST' });
    fetchWallets();
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Wallets</h1>
          <p className="text-slate-500 mt-1 text-sm">Manage your connected wallets</p>
        </div>
      </div>

      {loading ? (
        <Card className="p-8"><div className="flex justify-center py-12"><div className="w-6 h-6 rounded-full border-2 border-blue-500/30 border-t-blue-500 animate-spin" /></div></Card>
      ) : wallets.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mb-4"><WalletIcon size={28} className="text-purple-500" /></div>
            <h3 className="text-lg font-semibold text-white mb-2">No wallets yet</h3>
            <p className="text-slate-500 text-sm mb-6 max-w-sm text-center">Add your first wallet to get started with automated minting.</p>
            <Button variant="primary"><ArrowUpRight size={16} /> Add Wallet</Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {wallets.map(w => (
            <WalletCard key={w.id} wallet={w} onCopy={handleCopy} onRemove={handleRemove} onRefresh={handleRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}