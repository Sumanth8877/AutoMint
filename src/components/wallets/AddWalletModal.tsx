'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';

interface AddWalletModalProps {
  onClose: () => void;
  onSubmit: (data: { address: string; nickname: string; chain: string }) => void;
}

export default function AddWalletModal({ onClose, onSubmit }: AddWalletModalProps) {
  const [address, setAddress] = useState('');
  const [nickname, setNickname] = useState('');
  const [chain, setChain] = useState('ethereum');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ address, nickname, chain });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-lg p-6 bg-[#0B0F14] border border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Add Wallet</h3>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Wallet Address" placeholder="0x..." value={address} onChange={(e) => setAddress(e.target.value)} required />
          <Input label="Nickname (optional)" placeholder="My Wallet" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Chain</label>
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="w-full bg-[#05070A] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-[#4F8CFF]"
            >
              <option value="ethereum">Ethereum</option>
              <option value="base">Base</option>
              <option value="polygon">Polygon</option>
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button onClick={handleSubmit} className="flex-1">Add Wallet</Button>
          </div>
        </form>
      </div>
    </div>
  );
}