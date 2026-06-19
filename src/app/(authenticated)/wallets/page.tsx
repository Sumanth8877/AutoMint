'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Wallet } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import WalletCard from '@/components/wallets/WalletCard';
import AddWalletModal from '@/components/wallets/AddWalletModal';
import { getWalletBalance } from '@/lib/blockchain/wallet';

interface Wallet {
  id: string;
  address: string;
  nickname: string | null;
  chain: string;
  createdAt: string;
}

export default function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [balances, setBalances] = useState<Record<string, { balance: string; symbol: string }>>({});

  const fetchWallets = async () => {
    const res = await fetch('/api/wallets');
    const data = await res.json();
    if (data.wallets) setWallets(data.wallets);
    setLoading(false);
  };

  useEffect(() => { fetchWallets(); }, []);

  useEffect(() => {
    wallets.forEach(async (w) => {
      const bal = await getWalletBalance(w.address, w.chain);
      setBalances(prev => ({ ...prev, [w.id]: bal }));
    });
  }, [wallets]);

  const handleAdd = async (data: { address: string; nickname: string; chain: string }) => {
    await fetch('/api/wallets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setShowModal(false);
    fetchWallets();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this wallet?')) return;
    await fetch('/api/wallets', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchWallets();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Wallets</h1>
          <p className="text-muted mt-1">Manage your connected wallets</p>
        </div>
        <Button variant="primary" size="md" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Wallet
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="loader" /></div>
      ) : wallets.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
              <Wallet size={28} className="text-muted" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No wallets connected</h3>
            <p className="text-muted text-sm mb-6 text-center max-w-sm">Connect your first wallet to start monitoring balances.</p>
            <Button variant="primary" size="md" onClick={() => setShowModal(true)}><Plus size={16} /> Add Wallet</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {wallets.map((w) => (
            <WalletCard key={w.id} {...w} balance={balances[w.id]} onDelete={() => handleDelete(w.id)} />
          ))}
        </div>
      )}

      {showModal && <AddWalletModal onClose={() => setShowModal(false)} onSubmit={handleAdd} />}
    </div>
  );
}