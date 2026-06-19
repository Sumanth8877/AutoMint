'use client';
import React from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { Wallet as WalletIcon, Copy, ExternalLink, Trash2, RefreshCw, Shield, Clock } from 'lucide-react';

export interface WalletData {
  id: string;
  name: string;
  address: string;
  chain: string;
  balance: string;
  createdAt: string;
  lastUsed?: string;
}

export default function WalletCard({ wallet, onCopy, onRemove, onRefresh }: { wallet: WalletData; onCopy: (address: string) => void; onRemove: (id: string) => void; onRefresh: (id: string) => void }) {
  return (
    <Card className="p-5 hover:border-[rgba(255,255,255,0.12)] transition-all duration-200">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-[#4F8CFF]/10 border border-[#4F8CFF]/20 flex items-center justify-center">
            <WalletIcon size={22} className="text-[#4F8CFF]" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{wallet.name}</h3>
            <p className="text-sm text-white/40 mt-0.5">
              {wallet.address.slice(0, 8)}...{wallet.address.slice(-6)}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <Badge variant="info" className="text-xs">{wallet.chain}</Badge>
              <span className="text-xs text-white/40">Balance: {wallet.balance}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => onCopy(wallet.address)} className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all" aria-label="Copy address">
            <Copy size={14} />
          </button>
          <button onClick={() => onRefresh(wallet.id)} className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all" aria-label="Refresh balance">
            <RefreshCw size={14} />
          </button>
          <button onClick={() => onRemove(wallet.id)} className="p-2 rounded-lg text-white/40 hover:text-[#F31260] hover:bg-[#F31260]/10 transition-all" aria-label="Remove wallet">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-white/40">
          <span className="flex items-center gap-1.5"><Shield size={12} className="text-[#18C964]" /> Encrypted</span>
          {wallet.lastUsed && <span className="flex items-center gap-1.5"><Clock size={12} /> {new Date(wallet.lastUsed).toLocaleDateString()}</span>}
        </div>
        <a href={`https://etherscan.io/address/${wallet.address}`} target="_blank" rel="noopener noreferrer" className="text-xs text-[#4F8CFF] hover:text-[#3D7AE8] flex items-center gap-1">
          Explorer <ExternalLink size={10} />
        </a>
      </div>
    </Card>
  );
}