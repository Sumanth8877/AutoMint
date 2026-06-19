'use client';
import React from 'react';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { CheckCircle2, Clock, AlertCircle, ExternalLink, Trash2, RefreshCw, Loader2, Timer } from 'lucide-react';
import CountdownTimer from './CountdownTimer';
import { CHAIN_NAMES } from '@/lib/blockchain/chains';

interface MintTask {
  id: string;
  quantity: number;
  status: string;
  createdAt: string;
  txHash?: string;
  wallet?: { address: string; chain: string } | null;
  collection?: { name: string } | null;
  contractAddress?: string;
  mintPrice?: string;
  scheduledFor?: string;
}

export function ActiveMintCard({ task, onDelete }: { task: MintTask; onDelete: (id: string) => void }) {
  return (
    <Card className="p-5 border-green-500/20 hover:border-green-500/30 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
            <Loader2 size={22} className="text-green-500 animate-spin" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{task.collection?.name || 'Unknown Collection'}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {task.wallet?.address ? `${task.wallet.address.slice(0,6)}...${task.wallet.address.slice(-4)}` : 'No wallet'}
              {' · '}{CHAIN_NAMES[task.wallet?.chain as keyof typeof CHAIN_NAMES] || task.wallet?.chain}
            </p>
          </div>
        </div>
        <Badge variant="info" className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          {task.status === 'running' ? 'Minting' : 'Active'}
        </Badge>
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
        <span>Qty: {task.quantity}</span>
        {task.mintPrice && <span>Price: {task.mintPrice} ETH</span>}
      </div>
      <div className="mt-4 pt-4 border-t border-blue-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Timer size={12} /> Executing...
        </div>
        <button onClick={() => onDelete(task.id)} className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all" aria-label="Cancel">
          <Trash2 size={14} />
        </button>
      </div>
    </Card>
  );
}

export function UpcomingMintCard({ task, onDelete }: { task: MintTask; onDelete: (id: string) => void }) {
  return (
    <Card className="p-5 border-blue-500/20 hover:border-blue-500/30 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Clock size={22} className="text-blue-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{task.collection?.name || 'Unknown Collection'}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {task.wallet?.address ? `${task.wallet.address.slice(0,6)}...${task.wallet.address.slice(-4)}` : 'No wallet'}
              {' · '}{CHAIN_NAMES[task.wallet?.chain as keyof typeof CHAIN_NAMES] || task.wallet?.chain}
            </p>
          </div>
        </div>
        <Badge variant="warning">Scheduled</Badge>
      </div>

      <div className="mt-4">
        <p className="text-xs text-slate-500 mb-1">Opens in</p>
        {task.scheduledFor ? (
          <CountdownTimer targetTime={task.scheduledFor} />
        ) : (
          <span className="text-sm font-medium text-white">TBD</span>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-blue-500/10 flex items-center justify-between">
        <div className="text-xs">
          <span className="text-blue-500 font-medium">Prepared ✅</span>
          <span className="text-slate-500 ml-3">Ready for mint open</span>
        </div>
        <button onClick={() => onDelete(task.id)} className="text-xs text-slate-500 hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-all" aria-label="Cancel schedule">
          Cancel
        </button>
      </div>
    </Card>
  );
}

export function CompletedMintCard({ task }: { task: MintTask }) {
  return (
    <Card className="p-5 border-slate-700/30 hover:border-slate-700/50 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center">
            <CheckCircle2 size={22} className="text-green-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{task.collection?.name || 'Unknown Collection'}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {task.wallet?.address ? `${task.wallet.address.slice(0,6)}...${task.wallet.address.slice(-4)}` : 'No wallet'}
              {' · '}{CHAIN_NAMES[task.wallet?.chain as keyof typeof CHAIN_NAMES] || task.wallet?.chain}
            </p>
          </div>
        </div>
        <Badge variant="success">Completed</Badge>
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
        <span>Qty: {task.quantity}</span>
        {task.mintPrice && <span>Price: {task.mintPrice} ETH</span>}
        <span>{new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
      {task.txHash && (
        <div className="mt-4 pt-4 border-t border-blue-500/10 flex items-center gap-2">
          <span className="text-xs text-slate-500">Tx: {task.txHash.slice(0,10)}...{task.txHash.slice(-6)}</span>
          <a href={`https://etherscan.io/tx/${task.txHash}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={12} className="text-blue-500 hover:text-blue-400" />
          </a>
        </div>
      )}
    </Card>
  );
}

export function FailedMintCard({ task, onDelete, onRetry }: { task: MintTask; onDelete: (id: string) => void; onRetry: (id: string) => void }) {
  return (
    <Card className="p-5 border-red-500/20 hover:border-red-500/30 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertCircle size={22} className="text-red-500" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{task.collection?.name || 'Unknown Collection'}</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {task.wallet?.address ? `${task.wallet.address.slice(0,6)}...${task.wallet.address.slice(-4)}` : 'No wallet'}
            </p>
          </div>
        </div>
        <Badge variant="danger">Failed</Badge>
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
        <span>Qty: {task.quantity}</span>
        <span>{new Date(task.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="mt-4 pt-4 border-t border-blue-500/10 flex items-center justify-end gap-2">
        <button onClick={() => onRetry(task.id)} className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-400 px-3 py-1.5 rounded-lg hover:bg-blue-500/10 transition-all">
          <RefreshCw size={12} /> Re-run
        </button>
        <button onClick={() => onDelete(task.id)} className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all" aria-label="Delete">
          <Trash2 size={14} />
        </button>
      </div>
    </Card>
  );
}