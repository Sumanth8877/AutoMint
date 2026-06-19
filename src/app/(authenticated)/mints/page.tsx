'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Zap, Trash2, X } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import { CHAIN_NAMES } from '@/lib/blockchain/chains';

interface MintTask {
  id: string;
  quantity: number;
  status: string;
  createdAt: string;
  wallet: { address: string; chain: string } | null;
  collection: { name: string } | null;
}

export default function MintsPage() {
  const [tasks, setTasks] = useState<MintTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchTasks = async () => {
    const res = await fetch('/api/mints');
    const data = await res.json();
    if (data.tasks) setTasks(data.tasks);
    setLoading(false);
  };

  useEffect(() => { fetchTasks(); }, []);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      walletId: (form.elements.namedItem('walletId') as HTMLSelectElement).value,
      collectionId: (form.elements.namedItem('collectionId') as HTMLSelectElement).value,
      quantity: (form.elements.namedItem('quantity') as HTMLInputElement).value,
    };
    await fetch('/api/mints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setShowModal(false);
    fetchTasks();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this mint task?')) return;
    await fetch('/api/mints', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchTasks();
  };

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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Mint Tasks</h1>
          <p className="text-muted mt-1">Manage your minting tasks</p>
        </div>
        <Button variant="primary" size="md" onClick={() => setShowModal(true)}>
          <Plus size={16} /> New Task
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="loader" /></div>
      ) : tasks.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-4">
              <Zap size={28} className="text-muted" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No mint tasks</h3>
            <p className="text-muted text-sm mb-6 text-center max-w-sm">Create your first mint task to get started.</p>
            <Button variant="primary" size="md" onClick={() => setShowModal(true)}><Plus size={16} /> New Task</Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <Card key={task.id} className="p-4 hover:border-blue-500/25 transition-all duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <Zap size={14} className="text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{task.collection?.name || 'Unknown Collection'}</p>
                    <p className="text-xs text-slate-500">
                      {task.wallet?.address ? `${task.wallet.address.slice(0, 6)}...${task.wallet.address.slice(-4)}` : 'No wallet'}
                      {' · '}
                      {CHAIN_NAMES[task.wallet?.chain as keyof typeof CHAIN_NAMES] || 'Unknown'}
                      {' · Qty: '}
                      {task.quantity}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {getStatusBadge(task.status)}
                  <button onClick={() => handleDelete(task.id)} className="p-2 rounded-lg text-slate-500 hover:text-danger hover:bg-red-500/10 transition-all">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-2xl p-6" style={{ background: 'rgba(17,24,39,0.98)', border: '1px solid rgba(59,130,246,0.15)' }}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>New Mint Task</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white p-1"><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Wallet</label>
                <select name="walletId" className="w-full bg-[#0B1120] border border-[rgba(59,130,246,0.15)] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50" required>
                  <option value="">Select wallet...</option>
                  {/* Populated dynamically */}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Collection</label>
                <select name="collectionId" className="w-full bg-[#0B1120] border border-[rgba(59,130,246,0.15)] rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500/50" required>
                  <option value="">Select collection...</option>
                </select>
              </div>
              <Input label="Quantity" name="quantity" type="number" min="1" defaultValue="1" />
              <div className="flex gap-3 pt-2">
                <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1">Create Task</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}