'use client';
import React, { useState, useEffect } from 'react';
import { Wallet as WalletIcon, Plus, Copy, Trash2, RefreshCw, ExternalLink } from 'lucide-react';

export default function WalletsPage() {
  const [wallets, setWallets] = useState<any[]>([]);
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
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white mb-2">Wallets</h1>
          <p className="text-white/60 text-sm">Manage your connected wallets</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-[#4F8CFF] text-white rounded-lg text-sm font-medium hover:bg-[#3D7AE8] transition-colors">
          <Plus className="w-4 h-4" />
          Add Wallet
        </button>
      </div>

      {loading ? (
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-8">
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-[#4F8CFF]/30 border-t-[#4F8CFF] animate-spin" />
          </div>
        </div>
      ) : wallets.length === 0 ? (
        <div className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-xl bg-[#4F8CFF]/10 border border-[#4F8CFF]/20 flex items-center justify-center mb-4">
              <WalletIcon className="w-8 h-8 text-[#4F8CFF]" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No wallets yet</h3>
            <p className="text-white/40 text-sm mb-6 max-w-sm text-center">Add your first wallet to get started with automated minting.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {wallets.map(w => (
            <div key={w.id} className="bg-[#0B0F14] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 hover:border-[rgba(255,255,255,0.12)] transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <p className="text-white font-medium">{w.nickname || 'Unnamed Wallet'}</p>
                    <span className="px-2 py-0.5 bg-white/5 text-white/60 text-xs rounded capitalize">{w.chain}</span>
                  </div>
                  <p className="text-white/40 text-sm font-mono">{w.address}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleCopy(w.address)} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                    <Copy className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleRefresh(w.id)} className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button className="p-2 text-white/40 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleRemove(w.id)} className="p-2 text-white/40 hover:text-[#F31260] hover:bg-[#F31260]/10 rounded-lg transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}