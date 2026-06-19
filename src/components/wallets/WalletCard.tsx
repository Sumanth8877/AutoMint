'use client';

import React from 'react';
import { Wallet, Trash2, ExternalLink } from 'lucide-react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { CHAIN_NAMES } from '@/lib/blockchain/chains';

interface WalletCardProps {
  id: string;
  address: string;
  nickname: string | null;
  chain: string;
  balance?: { balance: string; symbol: string };
  createdAt: string;
  onDelete: () => void;
}

export default function WalletCard({ id, address, nickname, chain, balance, createdAt, onDelete }: WalletCardProps) {
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

  return (
    <Card glow className="p-5 hover:border-blue-500/25 transition-all duration-300">
      <div className="flex items-start justify-between mb-4">
        <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
          <Wallet size={18} className="text-blue-500" />
        </div>
        <button
          onClick={onDelete}
          className="p-2 rounded-lg text-slate-500 hover:text-danger hover:bg-red-500/10 transition-all"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="mb-3">
        <h3 className="text-sm font-semibold text-white mb-1 truncate">
          {nickname || 'Unnamed Wallet'}
        </h3>
        <p className="text-xs text-slate-400 font-mono">{shortAddress}</p>
      </div>

      <div className="flex items-center justify-between">
        <Badge variant="info">{CHAIN_NAMES[chain as keyof typeof CHAIN_NAMES] || chain}</Badge>
        {balance && (
          <span className="text-xs text-slate-400">
            {parseFloat(balance.balance).toFixed(4)} {balance.symbol}
          </span>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
        <span className="text-xs text-slate-600">
          Added {new Date(createdAt).toLocaleDateString()}
        </span>
        <a
          href={`https://etherscan.io/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:text-blue-400 flex items-center gap-1"
        >
          <ExternalLink size={12} />
        </a>
      </div>
    </Card>
  );
}