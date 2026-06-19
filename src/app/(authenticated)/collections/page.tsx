'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Folders, Trash2, X } from 'lucide-react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import { CHAIN_NAMES } from '@/lib/blockchain/chains';

interface Collection {
  id: string;
  name: string;
  contractAddress: string;
  chain: string;
  mintStatus: string;
  floorPrice: string | null;
  createdAt: string;
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchCollections = async () => {
    const res = await fetch('/api/collections');
    const data = await res.json();
    if (data.collections) setCollections(data.collections);
    setLoading(false);
  };

  useEffect(() => { fetchCollections(); }, []);

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      name: (form.elements.namedItem('name') as HTMLInputElement).value,
      contractAddress: (form.elements.namedItem('contractAddress') as HTMLInputElement).value,
      chain: (form.elements.namedItem('chain') as HTMLSelectElement).value,
    };
    await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setShowModal(false);
    fetchCollections();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this collection?')) return;
    await fetch('/api/collections', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    fetchCollections();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white">Collections</h1>
          <p className="text-white/60 mt-1">Manage your NFT collections</p>
        </div>
        <Button variant="primary" size="md" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Add Collection
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="loader" /></div>
      ) : collections.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 rounded-lg bg-[#4F8CFF]/10 border border-[#4F8CFF]/20 flex items-center justify-center mb-4">
              <Folders size={28} className="text-white/40" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">No collections added</h3>
            <p className="text-white/40 text-sm mb-6 text-center max-w-sm">Add your first collection to start tracking.</p>
            <Button variant="primary" size="md" onClick={() => setShowModal(true)}><Plus size={16} /> Add Collection</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((c) => (
            <Card key={c.id} className="p-5 hover:border-[rgba(255,255,255,0.12)] transition-all duration-200">
              <div className="flex items-start justify-between mb-4">
                <div className="p-2.5 rounded-lg bg-[#4F8CFF]/10 border border-[#4F8CFF]/20">
                  <Folders size={18} className="text-[#4F8CFF]" />
                </div>
                <button onClick={() => handleDelete(c.id)} className="p-2 rounded-lg text-white/40 hover:text-[#F31260] hover:bg-[#F31260]/10 transition-all">
                  <Trash2 size={16} />
                </button>
              </div>
              <h3 className="text-sm font-semibold text-white mb-1 truncate">{c.name}</h3>
              <p className="text-xs text-white/40 font-mono mb-3">{c.contractAddress.slice(0, 10)}...{c.contractAddress.slice(-6)}</p>
              <div className="flex items-center justify-between">
                <Badge variant="info">{CHAIN_NAMES[c.chain as keyof typeof CHAIN_NAMES] || c.chain}</Badge>
                <span className="text-xs text-white/40">{c.mintStatus}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-lg p-6 bg-[#0B0F14] border border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">Add Collection</h3>
              <button onClick={() => setShowModal(false)} className="text-white/60 hover:text-white p-1"><X size={20} /></button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <Input label="Collection Name" name="name" placeholder="Bored Ape Yacht Club" required />
              <Input label="Contract Address" name="contractAddress" placeholder="0x..." required />
              <div>
                <label className="block text-sm font-medium text-white/60 mb-2">Chain</label>
                <select name="chain" className="w-full bg-[#05070A] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#4F8CFF]">
                  <option value="ethereum">Ethereum</option>
                  <option value="base">Base</option>
                  <option value="polygon">Polygon</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">Cancel</Button>
                <Button type="submit" className="flex-1">Add Collection</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}